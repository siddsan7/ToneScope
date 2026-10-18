#include <juce_audio_utils/juce_audio_utils.h>
#if TONESCOPE_WEB_FRONTEND
#include <juce_gui_extra/juce_gui_extra.h>
#include <ToneScopeWeb.h>
#include "WebFrontend.h"
#endif

#include <juce_dsp/juce_dsp.h>

#include <juce_cryptography/juce_cryptography.h>

#include <tonescope/Engine.h>

#include <tonescope/Session.h>
#include <tonescope/ParameterState.h>
#include "CaptureWorker.h"
#include "SessionRecovery.h"
#if __has_include("AssistantBridge.h")
#include "AssistantBridge.h"
#endif

#include <atomic>

#include <array>

#include <cmath>

#include <functional>

#include <memory>

#include <optional>

#include <stdexcept>
#include <cstdlib>



namespace {

constexpr int chunk = 512;

constexpr double maxSeconds = 120.0;

struct Rendered {

    std::shared_ptr<const tonescope::AudioData> raw, dry, wet, exportWet;

    juce::String graphKey;

    std::vector<float> dryPeaks, wetPeaks;

    tonescope::Comparison comparison;

    std::vector<double> drySpectrum, wetSpectrum;

    std::vector<tonescope::DynamicsFrame> dryDynamics, wetDynamics;
    int latency = 0; std::uint64_t ingressClamps = 0;

};

struct Job final : juce::ThreadPoolJob {

    explicit Job(std::function<void()> f, bool replace = false) : ThreadPoolJob("ToneScope file worker"), fn(std::move(f)), replaceable(replace) {}

    JobStatus runJob() override { fn(); return jobHasFinished; }

    std::function<void()> fn;

    bool replaceable;

};

struct Palette {

    juce::Colour background, surface, ink, muted, grid, dry, wet;

    static Palette get() {

        if (juce::Desktop::getInstance().isDarkModeActive())

            return {juce::Colour(0xff131c27),juce::Colour(0xff1d2a38),juce::Colour(0xffedf3f8),juce::Colour(0xffb4c5d6),juce::Colour(0xff3c5064),juce::Colour(0xff83c4ee),juce::Colour(0xffffc080)};

        return {juce::Colour(0xffeaf0f5),juce::Colour(0xfff9fbfd),juce::Colour(0xff172c40),juce::Colour(0xff435e75),juce::Colour(0xffb8c8d5),juce::Colour(0xff156296),juce::Colour(0xff944c05)};

    }

};

class Microscope final : public juce::Component {

public:

    std::shared_ptr<const Rendered> data;

    double first=0, last=1, playhead=0;

    std::function<void(double,double)> selection;

    void paint(juce::Graphics& g) override {

        auto p=Palette::get(); auto b=getLocalBounds().toFloat();

        g.setColour(p.surface); g.fillRoundedRectangle(b,12);

        g.setColour(p.ink); g.setFont(juce::FontOptions(16.0f,juce::Font::bold));

        g.drawText("TIME / FREQUENCY",20,12,getWidth()-40,24,juce::Justification::left);

        g.setFont(juce::FontOptions(13.0f)); g.setColour(p.muted);

        g.drawText("Dry -   Processed |||     Drag waveform to select a passage",20,38,getWidth()-40,24,juce::Justification::left);

        auto wave=juce::Rectangle<float>(20,78,(float)getWidth()-40,(float)getHeight()*0.43f);

        auto spec=juce::Rectangle<float>(20,wave.getBottom()+36,(float)getWidth()-40,(float)getHeight()-wave.getBottom()-66);

        g.setColour(p.grid); g.drawHorizontalLine((int)wave.getCentreY(),wave.getX(),wave.getRight());

        for(int i=0;i<=4;++i) { auto x=wave.getX()+wave.getWidth()*i/4; g.drawVerticalLine((int)x,wave.getY(),wave.getBottom()); }

        if(!data) { g.setColour(p.muted); g.drawFittedText("Import a WAV or capture a live take.\nYour sound becomes the instrument of study.",wave.toNearestInt(),juce::Justification::centred,3); return; }

        auto frames=data->dry->frames();

        g.setColour(p.dry.withAlpha(0.12f)); g.fillRect(juce::Rectangle<float>(wave.getX()+wave.getWidth()*(float)first,wave.getY(),wave.getWidth()*(float)(last-first),wave.getHeight()));

        auto drawWave=[&](const std::vector<float>& peaks,juce::Colour c,bool dotted) {

            g.setColour(c);if(peaks.empty())return;

            for(int x=0;x<(int)wave.getWidth();++x) {

                if(dotted && x%4>=2)continue;

                auto bin=juce::jmin(peaks.size()-1,(size_t)((double)x/wave.getWidth()*peaks.size()));

                auto h=juce::jmin(1.0f,peaks[bin])*wave.getHeight()*0.48f;

                g.drawVerticalLine((int)wave.getX()+x,wave.getCentreY()-h,wave.getCentreY()+h);

            }

        };

        drawWave(data->dryPeaks,p.dry,false); drawWave(data->wetPeaks,p.wet,true);

        g.setColour(p.ink); auto px=wave.getX()+(float)playhead*wave.getWidth(); g.drawLine(px,wave.getY(),px,wave.getBottom(),1.5f);

        g.setFont(juce::FontOptions(13.0f)); g.drawText(juce::String(frames/data->dry->sampleRate,2)+" s  /  "+juce::String((int)data->dry->samples.size())+" channels",wave.toNearestInt().withY((int)wave.getBottom()+6).withHeight(24),juce::Justification::right);

        for(int i=0;i<=3;++i) { auto y=spec.getY()+spec.getHeight()*i/3; g.setColour(p.grid); g.drawHorizontalLine((int)y,spec.getX(),spec.getRight()); }

        auto trace=[&](const std::vector<double>& values,juce::Colour c,bool dotted) {

            juce::Path path; bool started=false;

            for(size_t k=1;k<values.size();++k) {

                auto hz=(double)k*data->dry->sampleRate/2048.0; if(hz<20)continue;

                auto x=spec.getX()+spec.getWidth()*(float)(std::log(hz/20)/std::log((data->dry->sampleRate/2)/20));

                auto db=20*std::log10(juce::jmax(1.0e-6,values[k]));

                auto y=spec.getBottom()-spec.getHeight()*(float)juce::jlimit(0.0,1.0,(db+120)/120);

                if(!started){path.startNewSubPath(x,y);started=true;}else path.lineTo(x,y);

            }

            g.setColour(c); if(dotted){ const float dashes[]{4,3}; juce::Path dash; juce::PathStrokeType(1.6f).createDashedStroke(dash,path,dashes,2);g.fillPath(dash); }else g.strokePath(path,juce::PathStrokeType(1.6f));

        };

        trace(data->drySpectrum,p.dry,false); trace(data->wetSpectrum,p.wet,true);

        g.setColour(p.muted); g.drawText("20 Hz       log frequency       Nyquist  |  0 to -120 dBFS  |  2048-point window at selection start",spec.toNearestInt().withY((int)spec.getBottom()+4).withHeight(22),juce::Justification::centred);

    }

    void mouseDown(const juce::MouseEvent& e) override { anchor=juce::jlimit(0.0,1.0,(e.x-20.0)/(getWidth()-40)); mouseDrag(e); }

    void mouseDrag(const juce::MouseEvent& e) override { if(!data)return;auto t=juce::jlimit(0.0,1.0,(e.x-20.0)/(getWidth()-40));first=juce::jmin(t,anchor);last=juce::jmax(t,anchor);repaint(); }

    void mouseUp(const juce::MouseEvent&) override { if(last-first<0.001){first=0;last=1;}if(selection)selection(first,last); }

private: double anchor=0;

};

struct StaleJobs final : juce::ThreadPool::JobSelector {

    bool isJobSuitable(juce::ThreadPoolJob* job) override { return static_cast<Job*>(job)->replaceable; }

};

class Main final : public juce::Component, private juce::AudioIODeviceCallback, private juce::Timer, private juce::DarkModeSettingListener {

public:

    explicit Main(bool openAudio = true, bool useWeb = true) {

        setName("ToneScope audio microscope"); setWantsKeyboardFocus(true);

        auto button=[&](juce::TextButton& b,const juce::String& text,std::function<void()> fn){b.setButtonText(text);b.setTitle(text);b.setWantsKeyboardFocus(true);b.onClick=std::move(fn);addAndMakeVisible(b);};

        button(importButton,"Import WAV",[this]{chooseImport();});

        button(playButton,"Play",[this]{togglePlay();});

        button(stopButton,"Rewind",[this]{playing=false;position=selectionStart.load();});

        button(deviceButton,"Audio devices",[this]{showDevices();});

        button(saveButton,"Save session",[this]{saveSession();});

        button(loadButton,"Open session",[this]{openSession();});

        button(exportButton,"Export wet WAV",[this]{exportAudio();});

        button(captureButton,"Capture take",[this]{toggleCapture();});

        loop.setButtonText("Loop selection"); loop.setTitle("Loop selected passage");loop.onClick=[this]{looping=loop.getToggleState();};addAndMakeVisible(loop);

        live.setButtonText("Monitor live input");live.setTitle("Explicitly enable input monitoring. Use headphones.");live.onClick=[this]{setLive(live.getToggleState());};addAndMakeVisible(live);

        match.setButtonText("Freeze RMS match");match.setTitle("Match processed RMS to dry over selected passage, capped at 12 dB");match.onClick=[this]{markRecovery();requestRender();};addAndMakeVisible(match);

        for(auto* b:{&loop,&live,&match})b->setWantsKeyboardFocus(true);

        mode.addItemList({"Dry","Processed","Raw residual","RMS-matched residual"},1);mode.setSelectedId(2);mode.setTitle("Audition source");mode.onChange=[this]{if(monitoring&&mode.getSelectedId()>2){mode.setSelectedId(2,juce::dontSendNotification);setStatus("Residual audition is available on captured replay. Live monitoring offers dry and processed.");}audition=mode.getSelectedId();markRecovery();requestRender();};addAndMakeVisible(mode);

        order.addItemList({"Compressor  >  EQ  >  Drive","Drive  >  EQ  >  Compressor","EQ  >  Compressor  >  Drive","Compressor  >  Drive  >  EQ","EQ  >  Drive  >  Compressor","Drive  >  Compressor  >  EQ"},1);order.setSelectedId(1);order.setTitle("Processing stage order");order.onChange=[this]{parametersChanged(true);};addAndMakeVisible(order);

        for(int i=0;i<3;++i){stages[(size_t)i].setButtonText(juce::StringArray{"Compressor","Tone EQ","Overdrive"}[i]);stages[(size_t)i].setTitle(stages[(size_t)i].getButtonText()+" enabled");stages[(size_t)i].onClick=[this]{parametersChanged(true);};addAndMakeVisible(stages[(size_t)i]);}

        addControl("Input",-24,24,0," dB",&tonescope::Parameters::inputDb);

        addControl("Threshold",-60,0,-18," dBFS",&tonescope::Parameters::thresholdDb);

        addControl("Ratio",1,20,4," :1",&tonescope::Parameters::ratio);

        addControl("Attack",0.1,100,10," ms",&tonescope::Parameters::attackMs);

        addControl("Release",10,2000,150," ms",&tonescope::Parameters::releaseMs);

        addControl("Knee",0,24,6," dB",&tonescope::Parameters::kneeDb);

        addControl("Makeup",-24,24,0," dB",&tonescope::Parameters::makeupDb);

        addControl("Low shelf",-18,18,0," dB",&tonescope::Parameters::lowDb);

        addControl("Mid gain",-18,18,0," dB",&tonescope::Parameters::midDb);

        addControl("Mid frequency",20,20000,1000," Hz",&tonescope::Parameters::midHz);

        addControl("Mid Q",0.2,10,0.707,"",&tonescope::Parameters::midQ);

        addControl("High shelf",-18,18,0," dB",&tonescope::Parameters::highDb);

        addControl("Drive",0,36,6," dB",&tonescope::Parameters::driveDb);

        addControl("Tone",20,20000,5000," Hz",&tonescope::Parameters::toneHz);

        addControl("Output",-24,24,0," dB",&tonescope::Parameters::outputDb);
        addControl("Low crossover",40,1000,200," Hz",&tonescope::Parameters::crossoverLowHz);
        addControl("High crossover",500,10000,2000," Hz",&tonescope::Parameters::crossoverHighHz);

        seek.setRange(0,1,0.00001);seek.setSliderStyle(juce::Slider::LinearHorizontal);seek.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);seek.setTitle("Playback position");seek.onValueChange=[this]{if(rendered)position=(int64_t)(seek.getValue()*rendered->dry->frames());};addAndMakeVisible(seek);

        selectionFrom.setTitle("Selection start seconds");selectionTo.setTitle("Selection end seconds");

        for(auto* e:{&selectionFrom,&selectionTo}) {e->setInputRestrictions(12,"0123456789.");e->onReturnKey=[this]{setSelectionSeconds();};e->onFocusLost=[this]{setSelectionSeconds();};addAndMakeVisible(e);}

        scope.selection=[this](double a,double b){setSelection(a,b);};addAndMakeVisible(scope);

        status.setText("Import a WAV to begin. Live monitoring is off.  Space: play/pause | Ctrl+O: import",juce::dontSendNotification);status.setTitle("Operation status");addAndMakeVisible(status);

        metrics.setTitle("Comparison measurements");addAndMakeVisible(metrics);

        juce::Desktop::getInstance().addDarkModeSettingListener(this); applyTheme();

        if(openAudio){auto error=devices.initialise(0,2,nullptr,true);if(error.isNotEmpty())setStatus("Audio output unavailable: "+error);}

        devices.addAudioCallback(this);startTimerHz(20);setSize(1280,980);
#if TONESCOPE_WEB_FRONTEND
        if(useWeb)initialiseWebFrontend();
#else
        juce::ignoreUnused(useWeb);
#endif
        history.reset(parameters());
        initialiseAssistant();
        auto recovery=tonescope::desktop::recoveryDirectory().getChildFile("session.json");
        if(recovery.existsAsFile())setStatus("A recovery session is available. Ctrl+Shift+R restores it; monitoring remains off.");
    }

    ~Main() override {stopTimer();shutdownAssistant();++revision;recording=false;devices.removeAudioCallback(this);if(captureWorker){captureWorker->interrupt();captureWorker->stop();}pool.removeAllJobs(true,-1);devices.closeAudioDevice();juce::Desktop::getInstance().removeDarkModeSettingListener(this);setLookAndFeel(nullptr);}

    void paint(juce::Graphics& g) override {

        auto p=Palette::get();g.fillAll(p.background);g.setColour(p.ink);g.setFont(juce::FontOptions(28.0f,juce::Font::bold));g.drawText("ToneScope",24,14,240,38,juce::Justification::left);

        g.setFont(juce::FontOptions(14.0f));g.setColour(p.muted);g.drawText("A closer listen.",24,51,200,22,juce::Justification::left);

        auto panel=juce::Rectangle<float>((float)getWidth()-342,102,318,(float)getHeight()-172);g.setColour(p.surface);g.fillRoundedRectangle(panel,12);

        g.setColour(p.ink);g.setFont(juce::FontOptions(17.0f,juce::Font::bold));g.drawText("Signal chain",(int)panel.getX()+16,112,280,26,juce::Justification::left);

        g.setFont(juce::FontOptions(13.0f));g.setColour(p.muted);g.drawText("Start bypassed. Enable a stage to hear it.",(int)panel.getX()+16,138,290,22,juce::Justification::left);

        g.setColour(p.ink);g.drawText("Selection (seconds)",24,getHeight()-133,160,22,juce::Justification::left);

    }

    void resized() override {

        #if TONESCOPE_WEB_FRONTEND
        if(browser){browser->setBounds(getLocalBounds());return;}
#endif
        int w=getWidth(),h=getHeight();auto top=juce::Rectangle<int>(270,22,w-294,34);

        for(auto* b:{&importButton,&loadButton,&saveButton,&exportButton})b->setBounds(top.removeFromLeft(juce::jmin(145,top.getWidth()/ (b==&exportButton?1:2))).reduced(3,0));

        deviceButton.setBounds(w-180,62,156,30);live.setBounds(w-388,62,202,30);captureButton.setBounds(w-530,62,136,30);

        int leftWidth=w-390;scope.setBounds(24,102,leftWidth,h-334);

        int x=w-326;order.setBounds(x,168,286,30);

        stages[0].setBounds(x,208,135,28);stages[1].setBounds(x+140,208,140,28);stages[2].setBounds(x,238,140,28);

        int y=278;int controlH=juce::jmax(23,(h-352)/(int)controls.size());

        for(auto& c:controls){c->label.setBounds(x,y,110,controlH);c->slider.setBounds(x+108,y,180,controlH);y+=controlH;}

        playButton.setBounds(24,h-205,86,34);stopButton.setBounds(118,h-205,86,34);loop.setBounds(218,h-205,165,34);mode.setBounds(24,h-163,202,30);match.setBounds(240,h-163,180,30);

        seek.setBounds(394,h-205,juce::jmax(90,leftWidth-370),34);

        selectionFrom.setBounds(184,h-130,100,28);selectionTo.setBounds(294,h-130,100,28);

        metrics.setBounds(24,h-96,w-48,30);status.setBounds(24,h-58,w-48,40);

    }

    bool keyPressed(const juce::KeyPress& key) override {

        if(key.getModifiers().isCommandDown()&&key.getKeyCode()=='Z'){if(key.getModifiers().isShiftDown())redoParameters();else undoParameters();return true;}
        if(key.getModifiers().isCommandDown()&&key.getKeyCode()=='Y'){redoParameters();return true;}
        if(key.getModifiers().isCommandDown()&&key.getModifiers().isShiftDown()&&key.getKeyCode()=='R'){restoreRecovery();return true;}
        if(key.getModifiers().isCommandDown()&&key.getModifiers().isShiftDown()&&key.getKeyCode()=='O'){openSession();return true;}
        if(key.getModifiers().isCommandDown()&&key.getKeyCode()=='E'){exportAudio();return true;}

        if(key==juce::KeyPress::spaceKey){togglePlay();return true;}

        if(key.getModifiers().isCommandDown()&&key.getKeyCode()=='O'){chooseImport();return true;}

        if(key.getModifiers().isCommandDown()&&key.getKeyCode()=='S'){saveSession();return true;}

        if(key.getKeyCode()==juce::KeyPress::escapeKey){playing=false;return true;}

        return false;

    }

    void loadSyntheticDemo() {

        auto demo=std::make_shared<tonescope::AudioData>();demo->sampleRate=48000;demo->samples.assign(2,std::vector<float>(96000));

        for(size_t n=0;n<demo->samples[0].size();++n){double t=n/48000.0;double envelope=std::exp(-3.5*std::fmod(t,0.5));double value=.34*envelope*(std::sin(2*juce::MathConstants<double>::pi*110*t)+.32*std::sin(2*juce::MathConstants<double>::pi*330*t));demo->samples[0][n]=(float)value;demo->samples[1][n]=(float)(value*.92);}

        source=demo;sourceFile={};stages[2].setToggleState(true,juce::dontSendNotification);scope.first=.1;scope.last=.8;requestRender();

    }

private:

    struct Control {juce::Label label;juce::Slider slider;juce::String key;float tonescope::Parameters::*member;};

    juce::LookAndFeel_V4 look;

    juce::AudioDeviceManager devices;tonescope::Engine liveEngine,liveDryEngine;

    juce::ThreadPool pool{1};std::unique_ptr<juce::FileChooser> chooser;

    std::vector<std::unique_ptr<Control>> controls;

    juce::TextButton importButton,playButton,stopButton,deviceButton,saveButton,loadButton,exportButton,captureButton;

    juce::ToggleButton loop,live,match;std::array<juce::ToggleButton,3> stages;

    juce::ComboBox mode,order;juce::Slider seek;juce::TextEditor selectionFrom,selectionTo;

    juce::Label status,metrics;Microscope scope;
    int oversampling=1;bool multiband=false;int auditionBand=0;

    std::shared_ptr<const tonescope::AudioData> source;

    std::shared_ptr<const Rendered> rendered;juce::File sourceFile;juce::String sourceDigest;

    std::atomic<bool> playing{false},monitoring{false},looping{false},recording{false},deviceFault{false};

    std::atomic<int> audition{2};std::atomic<double> position{0};std::atomic<int64_t> selectionStart{0},selectionEnd{0};

    std::atomic<float> outputPeak{0},reduction{0};std::atomic<uint64_t> invalid{0},guardSamples{0};

    std::array<tonescope::Parameters,32> commands{};std::atomic<unsigned> commandWrite{0},commandRead{0};

    std::array<std::array<float,chunk>,2> inputScratch{},outputScratch{},dryScratch{};

    std::shared_ptr<tonescope::desktop::CaptureWorker> captureWorker;juce::File capturePath;
    tonescope::session::ParameterHistory history;bool restoringParameters=false;
    bool recoveryDirty=false,captureFinalizing=false;juce::int64 recoveryDue=0;
    std::atomic<double> deviceRate{48000};std::atomic<double> sourceStep{1};

    std::atomic<int> deviceBlock{0};juce::String metricSummary;uint64_t revision=0,renderedRevision=0;int64_t renderDue=0;bool busy=false;

    static_assert(std::atomic<int64_t>::is_always_lock_free && std::atomic<float>::is_always_lock_free && std::atomic<double>::is_always_lock_free);

    #include "WebFrontend.inc"
    void setStatus(const juce::String& s){status.setText(s,juce::dontSendNotification);}

    void addControl(const juce::String& name,double a,double b,double v,const juce::String& unit,float tonescope::Parameters::*member) {

        static constexpr const char* keys[]{"inputDb","thresholdDb","ratio","attackMs","releaseMs","kneeDb","makeupDb","lowDb","midDb","midHz","midQ","highDb","driveDb","toneHz","outputDb","crossoverLowHz","crossoverHighHz"};

        auto c=std::make_unique<Control>();c->key=keys[controls.size()];c->member=member;c->label.setText(name,juce::dontSendNotification);c->label.setFont(juce::FontOptions(13.0f));c->slider.setRange(a,b,0);c->slider.setNumDecimalPlacesToDisplay(2);c->slider.setValue(v);c->slider.setTextValueSuffix(unit);c->slider.setSliderStyle(juce::Slider::LinearHorizontal);c->slider.setTextBoxStyle(juce::Slider::TextBoxRight,false,90,24);c->slider.setTitle(name);c->slider.setWantsKeyboardFocus(true);c->slider.onValueChange=[this,key=c->key]{parametersChanged(key=="crossoverLowHz"||key=="crossoverHighHz");};addAndMakeVisible(c->label);addAndMakeVisible(c->slider);controls.push_back(std::move(c));

    }

    tonescope::Parameters parameters() const {

        tonescope::Parameters p;for(auto& c:controls)p.*(c->member)=(float)c->slider.getValue();p.compressor=stages[0].getToggleState();p.equalizer=stages[1].getToggleState();p.drive=stages[2].getToggleState();p.oversampling=oversampling;p.multiband=multiband;

        constexpr std::array<std::array<int,3>,6> orders{{{0,1,2},{2,1,0},{1,0,2},{0,2,1},{1,2,0},{2,0,1}}};p.order=orders[(size_t)juce::jlimit(0,5,order.getSelectedId()-1)];return p;

    }

    void parametersChanged(bool topology=false){
        assistantSessionChanged();

        if(topology&&monitoring){if(recording)toggleCapture();else setLive(false);setStatus("Signal-chain change stopped monitoring. Re-enable it when ready.");}

        auto p=parameters();std::string error;if(!tonescope::validate(p,monitoring?deviceRate.load():(source?source->sampleRate:48000),error)){playing=false;++revision;busy=false;setStatus(error);return;}

        if(!restoringParameters)history.commit(p);markRecovery();

        if(topology){playing=false;detach();commandRead.store(commandWrite.load());attach();}
        auto w=commandWrite.load();if(w-commandRead.load(std::memory_order_acquire)<commands.size()){commands[w%commands.size()]=p;commandWrite.store(w+1,std::memory_order_release);}else setStatus("Control queue full; pause adjustment and retry.");

        if(source&&!monitoring){playing=false;busy=true;renderDue=juce::Time::currentTimeMillis()+180;++revision;setStatus("Settings changed | updating comparison...");}

    }

    void applyTheme(){auto p=Palette::get();look.setColour(juce::ResizableWindow::backgroundColourId,p.background);look.setColour(juce::Label::textColourId,p.ink);look.setColour(juce::ToggleButton::textColourId,p.ink);look.setColour(juce::ToggleButton::tickColourId,p.dry);look.setColour(juce::TextButton::buttonColourId,p.surface);look.setColour(juce::TextButton::textColourOffId,p.ink);look.setColour(juce::ComboBox::backgroundColourId,p.surface);look.setColour(juce::ComboBox::textColourId,p.ink);look.setColour(juce::Slider::textBoxTextColourId,p.ink);look.setColour(juce::Slider::textBoxBackgroundColourId,p.surface);look.setColour(juce::Slider::textBoxOutlineColourId,p.muted);look.setColour(juce::ComboBox::arrowColourId,p.ink);look.setColour(juce::ComboBox::outlineColourId,p.muted);look.setColour(juce::ToggleButton::tickDisabledColourId,p.muted);look.setColour(juce::Slider::thumbColourId,p.dry);look.setColour(juce::Slider::trackColourId,p.dry);look.setColour(juce::TextEditor::backgroundColourId,p.surface);look.setColour(juce::TextEditor::textColourId,p.ink);setLookAndFeel(&look);repaint();}

    void darkModeSettingChanged() override{applyTheme();}

    void timerCallback() override {
        updateAssistant();

        if(deviceFault.exchange(false)){live.setToggleState(false,juce::dontSendNotification);setStatus("Monitoring stopped after a device or control fault. Check Audio devices, then explicitly re-enable.");}

        if(renderDue&&juce::Time::currentTimeMillis()>=renderDue){renderDue=0;requestRender();}

        auto isPlaying=playing.load();playButton.setButtonText(isPlaying?"Pause":"Play");

        playButton.setEnabled(rendered&&renderedRevision==revision&&!busy&&!monitoring);captureButton.setEnabled(monitoring);

        if(rendered){auto t=(double)position.load()/juce::jmax<int64_t>(1,rendered->dry->frames());seek.setValue(t,juce::dontSendNotification);scope.playhead=t;scope.repaint();}

        if(captureWorker&&captureWorker->stopped()&&!captureFinalizing){recording=false;finishCapture();}
        if(recoveryDirty&&juce::Time::currentTimeMillis()>=recoveryDue){recoveryDirty=false;if(sourceFile.existsAsFile()){auto text=juce::JSON::toString(session());pool.addJob(new Job([text]{auto folder=tonescope::desktop::recoveryDirectory();if(folder.createDirectory())tonescope::desktop::saveSessionAtomically(folder.getChildFile("session.json"),text);}),true);}}

        if(monitoring){metrics.setText("LIVE | "+juce::String(deviceRate.load(),0)+" Hz | "+juce::String(deviceBlock.load())+" sample buffer | peak "+juce::String(20*std::log10(juce::jmax(1.0e-6f,outputPeak.load())),1)+" dBFS | gain reduction "+juce::String(reduction.load(),1)+" dB | invalid samples "+juce::String((juce::int64)invalid.load())+" | guard interventions "+juce::String((juce::int64)guardSamples.load()),juce::dontSendNotification);}

    }

    void detach(){devices.removeAudioCallback(this);}void attach(){auto w=commandWrite.load();if(w-commandRead.load(std::memory_order_acquire)<commands.size()){commands[w%commands.size()]=parameters();commandWrite.store(w+1,std::memory_order_release);}devices.addAudioCallback(this);}

    void togglePlay(){if(rendered&&renderedRevision==revision&&!busy&&!monitoring){if(position>=selectionEnd)position=selectionStart.load();playing=!playing.load();}}

    void audioDeviceAboutToStart(juce::AudioIODevice* d) override {if(monitoring.exchange(false))deviceFault=true;playing=false;deviceRate=d->getCurrentSampleRate();deviceBlock=d->getCurrentBufferSizeSamples();try{auto p=parameters();liveEngine.prepare(deviceRate.load(),2,p);tonescope::Parameters dry;dry.inputDb=p.inputDb;dry.toneHz=(float)juce::jmin(5000.0,.45*deviceRate.load());liveDryEngine.prepare(deviceRate.load(),2,dry);}catch(...){deviceFault=true;}if(rendered)sourceStep=rendered->dry->sampleRate/deviceRate;}

    void audioDeviceStopped() override {playing=false;monitoring=false;if(recording.exchange(false)&&captureWorker)captureWorker->interrupt();}

    void audioDeviceError(const juce::String&) override {playing=false;monitoring=false;if(recording.exchange(false)&&captureWorker)captureWorker->interrupt();deviceFault=true;}

    void audioDeviceIOCallbackWithContext(const float* const* ins,int ni,float* const* outs,int no,int frames,const juce::AudioIODeviceCallbackContext&) override {

        juce::ScopedNoDenormals denormals;

        for(int c=0;c<no;++c)if(outs[c])juce::FloatVectorOperations::clear(outs[c],frames);

        auto r=commandRead.load();const auto w=commandWrite.load(std::memory_order_acquire);if(r!=w){tonescope::Parameters latest;for(unsigned n=0;r!=w&&n<32;++n,++r)latest=commands[r%commands.size()];tonescope::Parameters dry;dry.inputDb=latest.inputDb;dry.toneHz=(float)juce::jmin(5000.0,.45*deviceRate.load());if(!liveEngine.setParametersRealtime(latest)||!liveDryEngine.setParametersRealtime(dry)){monitoring=false;playing=false;deviceFault=true;}}commandRead.store(r,std::memory_order_release);

        float peak=0;uint64_t guarded=0;

        if(monitoring.load()) {

            for(int offset=0;offset<frames;offset+=chunk){int n=juce::jmin(chunk,frames-offset);

                for(int c=0;c<2;++c)for(int i=0;i<n;++i){auto v=ni>0&&ins[juce::jmin(c,ni-1)]?ins[juce::jmin(c,ni-1)][offset+i]:0.0f;inputScratch[(size_t)c][(size_t)i]=std::isfinite(v)?v:0;}

                if(recording.load(std::memory_order_acquire)&&captureWorker){const float* data[]{inputScratch[0].data(),inputScratch[1].data()};if(!captureWorker->push(data,n))recording=false;}

                const float* ip[]{inputScratch[0].data(),inputScratch[1].data()};float* op[]{outputScratch[0].data(),outputScratch[1].data()};liveEngine.process(ip,op,n);
                float* dryOut[]{dryScratch[0].data(),dryScratch[1].data()};liveDryEngine.process(ip,dryOut,n);

                for(int c=0;c<no;++c)if(outs[c])for(int i=0;i<n;++i){float v=audition.load()==1?dryScratch[(size_t)juce::jmin(c,1)][(size_t)i]:outputScratch[(size_t)juce::jmin(c,1)][(size_t)i];if(!std::isfinite(v)||std::abs(v)>0.95f)++guarded;v=std::isfinite(v)?juce::jlimit(-0.95f,0.95f,v):0;outs[c][offset+i]=v;peak=juce::jmax(peak,std::abs(v));}

            }

            reduction=liveEngine.gainReductionDb();invalid=liveEngine.invalidSamples();

        }else if(playing.load()&&rendered){

            auto* a=rendered.get();double pos=(double)position.load();auto start=selectionStart.load(),end=selectionEnd.load();auto choice=audition.load();double gain=a->comparison.valid?a->comparison.gain:1;

            for(int i=0;i<frames;++i){if(pos>=end){if(looping.load())pos=(double)start;else{playing=false;break;}}auto at=juce::jlimit<int64_t>(0,a->dry->frames()-1,(int64_t)pos);auto next=juce::jmin(at+1,a->dry->frames()-1);float t=(float)(pos-std::floor(pos));

                for(int c=0;c<no;++c)if(outs[c]){auto channel=(size_t)juce::jmin(c,(int)a->dry->samples.size()-1);auto sample=[&](const tonescope::AudioData& audio,int offset){return audio.samples[channel][(size_t)(at+offset)]*(1-t)+audio.samples[channel][(size_t)juce::jmin<int64_t>(next+offset,audio.frames()-1)]*t;};float dry=sample(*a->dry,0),wet=sample(*a->wet,a->latency);float v=choice==1?dry:choice==2?(float)(wet*gain):choice==3?wet-dry:(float)(wet*gain)-dry;

                    // A short boundary envelope belongs only to monitor playback, never measurements.

                    auto fade=juce::jlimit(0.0,1.0,juce::jmin((pos-start)/128.0,(end-pos)/128.0));v=(float)(v*fade);if(!std::isfinite(v)||std::abs(v)>0.95f)++guarded;v=std::isfinite(v)?juce::jlimit(-0.95f,0.95f,v):0;outs[c][i]=v;peak=juce::jmax(peak,std::abs(v));}

                pos+=sourceStep.load();}

            position=pos;

        }

        outputPeak=peak;guardSamples.fetch_add(guarded,std::memory_order_relaxed);

    }

    void chooseImport(){

        chooser=std::make_unique<juce::FileChooser>("Import mono or stereo WAV",juce::File{},"*.wav");auto safe=juce::Component::SafePointer<Main>(this);

        chooser->launchAsync(juce::FileBrowserComponent::openMode|juce::FileBrowserComponent::canSelectFiles,[safe](const juce::FileChooser& f){if(safe&&f.getResult().existsAsFile())safe->loadAudio(f.getResult());});

    }

    void loadAudio(const juce::File& file,juce::String expectedDigest={},juce::var restoredState={}){
        assistantSessionChanged();

        if(monitoring){setLive(false);live.setToggleState(false,juce::dontSendNotification);}

        playing=false;busy=true;const auto token=++revision;StaleJobs stale;pool.removeAllJobs(false,0,&stale);setStatus("Loading "+file.getFileName()+"...");auto safe=juce::Component::SafePointer<Main>(this);

        pool.addJob(new Job([safe,file,token,expectedDigest,restoredState]{

            try{if(file.getSize()>100*1024*1024)throw std::runtime_error("Development cached importer accepts files up to 100 MiB / 120 seconds.");juce::FileInputStream before(file);if(before.failedToOpen())throw std::runtime_error("Cannot hash source.");auto digest=juce::SHA256(before).toHexString();if(expectedDigest.isNotEmpty()&&expectedDigest!=digest)throw std::runtime_error("Session source content changed; import it as a new source.");auto audio=std::make_shared<tonescope::AudioData>(tonescope::readWav(file.getFullPathName().toStdString()));juce::FileInputStream after(file);if(after.failedToOpen()||juce::SHA256(after).toHexString()!=digest)throw std::runtime_error("Source changed while importing; retry from a stable file.");

                if(audio->frames()<1||audio->frames()/audio->sampleRate>maxSeconds)throw std::runtime_error("Use a WAV between one frame and 120 seconds for the cached microscope.");
                if(restoredState.isObject()){std::string error;if(!tonescope::validate(tonescope::session::loadParametersDocument(restoredState),audio->sampleRate,error))throw std::runtime_error("Session/source rate mismatch: "+error);}

                juce::MessageManager::callAsync([safe,audio,file,token,digest,restoredState]{if(!safe||safe->revision!=token)return;safe->source=audio;safe->sourceFile=file;safe->sourceDigest=digest;safe->scope.first=0;safe->scope.last=1;
                    if(restoredState.isObject()){
                        safe->applyParameterTransaction(tonescope::session::loadParametersDocument(restoredState));auto ui=restoredState["ui"];safe->auditionBand=ui.hasProperty("band")?(int)ui["band"]:0;
                        safe->scope.first=ui.hasProperty("selection_start")?(double)ui["selection_start"]:0;safe->scope.last=ui.hasProperty("selection_end")?(double)ui["selection_end"]:1;
                        auto selected=ui["audition"].toString();bool rms=(bool)ui["rms_match"];int modeId=selected=="dry"?1:selected=="residual"?(rms?4:3):2;
                        safe->mode.setSelectedId(modeId,juce::dontSendNotification);safe->audition=modeId;safe->match.setToggleState(rms,juce::dontSendNotification);
                    }
                    safe->markRecovery();safe->requestRender();});

            }catch(const std::exception& e){auto message=juce::String(e.what());juce::MessageManager::callAsync([safe,message,token]{if(safe&&safe->revision==token){safe->busy=false;safe->setStatus("Import failed: "+message);}});}

        },true),true);

    }

    void requestRender(){
        assistantSessionChanged();

        if(!source||monitoring)return;playing=false;busy=true;const auto token=++revision;StaleJobs stale;pool.removeAllJobs(false,0,&stale);auto input=source;auto p=parameters();auto a=(int64_t)(scope.first*input->frames()),b=(int64_t)(scope.last*input->frames());b=juce::jlimit<int64_t>(a+1,input->frames(),b);bool rms=match.getToggleState()||mode.getSelectedId()==4;

        auto previous=rendered;auto key=juce::JSON::toString(session()["parameters"],true)+"|band="+juce::String(auditionBand);auto band=auditionBand;

        auto safe=juce::Component::SafePointer<Main>(this);setStatus("Rendering full source history and selected-passage measurements...");

        pool.addJob(new Job([safe,token,input,p,a,b,rms,previous,key,band]{try{

            auto result=std::make_shared<Rendered>();result->raw=input;result->graphKey=key;

            if(previous&&previous->raw==input&&previous->graphKey==key){result->dry=previous->dry;result->wet=previous->wet;result->exportWet=previous->exportWet;result->dryPeaks=previous->dryPeaks;result->wetPeaks=previous->wetPeaks;result->ingressClamps=previous->ingressClamps;}

            else {

                result->wet=std::make_shared<tonescope::AudioData>(tonescope::render(*input,p));
                result->exportWet=result->wet;

                auto reference=std::make_shared<tonescope::AudioData>(*input);auto trim=std::pow(10.0,p.inputDb/20.0);for(auto& channel:reference->samples)for(auto& value:channel){if(std::abs(value)>16.0f)++result->ingressClamps;value=(float)(juce::jlimit(-16.0f,16.0f,value)*trim);}result->dry=p.multiband&&p.compressor?std::make_shared<tonescope::AudioData>(tonescope::crossoverReference(*input,p)):reference;
                if(band!=0){auto pair=tonescope::auditionPair(*result->dry,*result->wet,(tonescope::AuditionBand)band,p.crossoverLowHz,p.crossoverHighHz);result->dry=std::make_shared<tonescope::AudioData>(std::move(pair.dry));result->wet=std::make_shared<tonescope::AudioData>(std::move(pair.wet));}

                auto peaks=[](const tonescope::AudioData& data){std::vector<float> values(2048,0);for(int64_t i=0;i<data.frames();++i){auto bin=(size_t)(i*2048/data.frames());for(auto& channel:data.samples)values[bin]=juce::jmax(values[bin],std::abs(channel[(size_t)i]));}return values;};result->dryPeaks=peaks(*result->dry);result->wetPeaks=peaks(*result->wet);

            }

            tonescope::Engine descriptor;descriptor.prepare(input->sampleRate,(int)input->samples.size(),p);result->latency=descriptor.latencySamples();
            const auto measuredEnd=juce::jmin<int64_t>(b,input->frames()-result->latency);
            if(a>=measuredEnd)throw std::runtime_error("Selection falls inside the unavailable latency tail. Extend the passage.");
            result->comparison=tonescope::compareAligned(*result->dry,*result->wet,a,measuredEnd,rms,result->latency);
            result->dryDynamics=tonescope::dynamics(*result->dry);result->wetDynamics=tonescope::dynamics(*result->wet);

            auto fft=[&](const tonescope::AudioData& data,int offset){tonescope::AudioData window;window.sampleRate=data.sampleRate;window.samples.assign(data.samples.size(),std::vector<float>(2048,0));for(size_t c=0;c<data.samples.size();++c)for(int64_t i=0;i<juce::jmin<int64_t>(2048,measuredEnd-a);++i)window.samples[c][(size_t)i]=data.samples[c][(size_t)(a+i+offset)];return tonescope::spectrum(window,0);};result->drySpectrum=fft(*result->dry,0);result->wetSpectrum=fft(*result->wet,result->latency);

            juce::MessageManager::callAsync([safe,token,result,a,b]{if(!safe||safe->revision!=token)return;safe->detach();safe->rendered=result;safe->renderedRevision=token;safe->sourceStep=result->dry->sampleRate/safe->deviceRate;safe->selectionStart=a;safe->selectionEnd=juce::jmin<int64_t>(b,result->dry->frames()-result->latency);safe->position=a;safe->scope.data=result;safe->busy=false;safe->attach();safe->selectionFrom.setText(juce::String(a/result->dry->sampleRate,3),false);safe->selectionTo.setText(juce::String(b/result->dry->sampleRate,3),false);

                const auto& c=result->comparison;safe->metrics.setText(c.valid?"Selected RMS | dry "+juce::String(20*std::log10(juce::jmax(1e-12,c.dryRms)),1)+" dBFS | wet "+juce::String(20*std::log10(juce::jmax(1e-12,c.wetRms)),1)+" dBFS | frozen match "+juce::String(20*std::log10(c.gain),2)+" dB"+(c.gainCapped?" (capped)":"")+" | delay "+juce::String(result->latency)+" samples (tail excluded) | ingress clamps "+juce::String((juce::int64)result->ingressClamps):"Comparison unavailable: passage is silent or invalid.",juce::dontSendNotification);

                safe->setStatus("Ready | "+juce::String(result->dry->sampleRate,0)+" Hz source | "+juce::String(result->dry->frames()/result->dry->sampleRate,2)+" s | Residual = wet - dry; it is not isolated distortion.");safe->scope.repaint();});

        }catch(const std::exception& e){auto message=juce::String(e.what());juce::MessageManager::callAsync([safe,token,message]{if(safe&&safe->revision==token){safe->busy=false;safe->setStatus("Render failed: "+message);}});}},true),true);

    }

    void setSelection(double a,double b){assistantSessionChanged();if(!source)return;scope.first=juce::jlimit(0.0,0.999999,a);scope.last=juce::jlimit(scope.first+1.0/source->frames(),1.0,b);markRecovery();requestRender();}

    void setSelectionSeconds(){if(!source)return;auto seconds=source->frames()/source->sampleRate;auto a=selectionFrom.getText().getDoubleValue(),b=selectionTo.getText().getDoubleValue();if(a<0||b<=a||b>seconds){setStatus("Selection needs a start before its end, inside the source duration.");return;}setSelection(a/seconds,b/seconds);}

    void showDevices(){

        if(captureWorker&&!captureFinalizing){recording=false;finishCapture();}playing=false;monitoring=false;live.setToggleState(false,juce::dontSendNotification);

        auto* selector=new juce::AudioDeviceSelectorComponent(devices,0,2,0,2,false,false,true,false);selector->setSize(520,420);

        juce::DialogWindow::LaunchOptions options;options.content.setOwned(selector);options.dialogTitle="Audio devices | monitoring stays off";options.dialogBackgroundColour=Palette::get().surface;options.escapeKeyTriggersCloseButton=true;options.useNativeTitleBar=true;options.resizable=false;options.launchAsync();

        setStatus("Select input/output and buffer size. Enable Monitor live input afterward. Device timing is reported, not a measured round trip.");

    }

    void setLive(bool enabled){
        assistantSessionChanged();
        playing=false;
        if(captureWorker&&!captureFinalizing){recording=false;finishCapture();}
        if(enabled){
            auto* d=devices.getCurrentAudioDevice();
            if(!d||d->getActiveInputChannels().countNumberOfSetBits()==0){live.setToggleState(false,juce::dontSendNotification);showDevices();setStatus("Select an input in Audio devices, then explicitly enable monitoring. Use headphones.");return;}
            std::string error;if(!tonescope::validate(parameters(),deviceRate.load(),error)){live.setToggleState(false,juce::dontSendNotification);setStatus("Device rate cannot use current controls: "+juce::String(error));return;}
            detach();commandRead.store(commandWrite.load());attach();monitoring=true;
            setStatus("LIVE monitoring on | calibrated dry input: ingress clamp +/-16 and smoothed input trim | use headphones | guard -0.45 dBFS.");
        }else{monitoring=false;setStatus("Live monitoring off. Captures are saved locally.");}
    }

    void toggleCapture(){
        if(captureFinalizing)return;
        if(captureWorker){recording=false;finishCapture();return;}
        if(!monitoring)return;
        auto folder=tonescope::desktop::recoveryDirectory().getChildFile("takes");
        if(folder.createDirectory().failed()){setStatus("Cannot create the local capture folder.");return;}
        capturePath=folder.getChildFile(juce::Uuid().toString()+".partial.wav");
        // Allocate the fixed 1 MiB queue before the callback sees the worker.
        detach();captureWorker=std::make_shared<tonescope::desktop::CaptureWorker>(capturePath.getFullPathName().toStdString(),deviceRate.load());attach();
        monitoring=true;recording=true;captureButton.setButtonText("Stop & save take");
        setStatus("Recording dry input to local disk | bounded queue | stops and marks incomplete on overflow | 2 GiB / 2 hour maximum.");
    }

    void finishCapture(){
        if(!captureWorker||captureFinalizing)return;
        recording=false;detach();auto worker=std::move(captureWorker);auto file=capturePath;attach();
        monitoring=false;live.setToggleState(false,juce::dontSendNotification);captureFinalizing=true;
        renderDue=0;const auto token=++revision;busy=true;captureButton.setButtonText("Finalizing take...");auto safe=juce::Component::SafePointer<Main>(this);
        pool.addJob(new Job([safe,worker,file,token]{
            worker->stop();const bool complete=worker->complete();auto saved=file;
            if(worker->frames()>0){
                auto target=file.getSiblingFile(file.getFileNameWithoutExtension()+(complete?".complete.wav":".incomplete.wav"));
                if(worker->fault()!=tonescope::desktop::CaptureWorker::Fault::io&&file.moveFileTo(target))saved=target;
                auto* metadata=new juce::DynamicObject();metadata->setProperty("schema_version",1);metadata->setProperty("complete",complete);metadata->setProperty("frames",(juce::int64)worker->frames());metadata->setProperty("fault",(int)worker->fault());metadata->setProperty("capture_tap","sanitized raw device input before ingress clamp and input trim");
                saved.withFileExtension("capture.json").replaceWithText(juce::JSON::toString(juce::var(metadata)));
            }
            juce::MessageManager::callAsync([safe,saved,complete,worker,token]{if(!safe)return;safe->captureFinalizing=false;safe->captureButton.setButtonText("Capture take");if(safe->revision!=token)return;safe->busy=false;
                if(!complete){safe->setStatus("Capture incomplete (overflow, interruption or disk fault). Preserved at "+saved.getFullPathName()+". Import explicitly to inspect the retained prefix.");return;}
                safe->loadAudio(saved);});
        }),true);
    }
    juce::var session() const {

        auto* root=new juce::DynamicObject();root->setProperty("schema_version",1);root->setProperty("source",sourceFile.getFullPathName());if(sourceDigest.isNotEmpty())root->setProperty("source_sha256",sourceDigest);

        auto* values=new juce::DynamicObject();for(auto& c:controls)values->setProperty(c->key,c->slider.getValue());

        values->setProperty("oversampling",oversampling);values->setProperty("multiband",multiband);values->setProperty("compressor",stages[0].getToggleState());values->setProperty("equalizer",stages[1].getToggleState());values->setProperty("drive",stages[2].getToggleState());

        juce::Array<juce::var> sequence;for(auto v:parameters().order)sequence.add(v);values->setProperty("order",sequence);root->setProperty("parameters",juce::var(values));

        auto* ui=new juce::DynamicObject();ui->setProperty("band",auditionBand);ui->setProperty("selection_start",scope.first);ui->setProperty("selection_end",scope.last);ui->setProperty("audition",mode.getSelectedId()==1?"dry":mode.getSelectedId()==2?"wet":"residual");ui->setProperty("rms_match",match.getToggleState()||mode.getSelectedId()==4);root->setProperty("ui",juce::var(ui));return root;

    }

    void saveSession(){

        if(!source){setStatus("Import or capture audio before saving a session.");return;}

        if(!sourceFile.existsAsFile()){setStatus("Demo sources are temporary. Import a WAV or record a persistent dry take before saving.");return;}

        chooser=std::make_unique<juce::FileChooser>("Save ToneScope session",juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("tone.tonescope.json"),"*.json");auto safe=juce::Component::SafePointer<Main>(this);auto json=juce::JSON::toString(session());

        chooser->launchAsync(juce::FileBrowserComponent::saveMode|juce::FileBrowserComponent::canSelectFiles|juce::FileBrowserComponent::warnAboutOverwriting,[safe,json](const juce::FileChooser& f){if(!safe||f.getResult()==juce::File{})return;auto file=f.getResult();safe->pool.addJob(new Job([safe,json,file]{auto ok=tonescope::desktop::saveSessionAtomically(file,json);juce::MessageManager::callAsync([safe,ok,file]{if(safe)safe->setStatus(ok?"Session saved atomically to "+file.getFileName():"Session save failed. Previous session preserved.");});}),true);});

    }

    void openSession(){
        chooser=std::make_unique<juce::FileChooser>("Open ToneScope session",juce::File{},"*.json");auto safe=juce::Component::SafePointer<Main>(this);
        chooser->launchAsync(juce::FileBrowserComponent::openMode|juce::FileBrowserComponent::canSelectFiles,[safe](const juce::FileChooser& f){if(safe&&f.getResult().existsAsFile())safe->loadSessionFile(f.getResult());});
    }

    void loadSessionFile(const juce::File& file){
        try{
            auto p=tonescope::session::loadParameters(file);std::string error;
            if(!tonescope::validate(p,48000,error))throw std::runtime_error(error);
            auto state=tonescope::session::migrateDocument(juce::JSON::parse(file));
            auto path=state["source"].toString();auto sourcePath=juce::File::isAbsolutePath(path)?juce::File(path):file.getParentDirectory().getChildFile(path);
            if(sourcePath.existsAsFile()){loadAudio(sourcePath,state["source_sha256"].toString(),state);return;}
            setStatus("Session source missing. Locate the original WAV; its saved SHA256 must match.");
            chooser=std::make_unique<juce::FileChooser>("Locate missing session source (SHA256 verified)",file.getParentDirectory(),"*.wav");auto safe=juce::Component::SafePointer<Main>(this);
            chooser->launchAsync(juce::FileBrowserComponent::openMode|juce::FileBrowserComponent::canSelectFiles,[safe,state](const juce::FileChooser& f){if(!safe||!f.getResult().existsAsFile())return;if(state["source_sha256"].toString().isEmpty()){safe->setStatus("Legacy session has no source digest. Import the replacement as a new source; saved correspondence cannot be verified.");return;}safe->loadAudio(f.getResult(),state["source_sha256"].toString(),state);});
        }catch(const std::exception& error){setStatus("Invalid session: "+juce::String(error.what()));}
    }

    void markRecovery(){recoveryDirty=true;recoveryDue=juce::Time::currentTimeMillis()+800;}
    void restoreRecovery(){
        auto folder=tonescope::desktop::recoveryDirectory();auto file=folder.getChildFile("session.json");
        auto partials=folder.getChildFile("takes").findChildFiles(juce::File::findFiles,false,"*.partial.wav");
        if(partials.isEmpty()){if(file.existsAsFile())loadSessionFile(file);else setStatus("No recovery session or interrupted capture is available.");return;}
        auto partial=partials.getFirst();for(const auto& candidate:partials)if(candidate.getLastModificationTime()>partial.getLastModificationTime())partial=candidate;if(file.existsAsFile()&&file.getLastModificationTime()>=partial.getLastModificationTime()){loadSessionFile(file);return;}auto safe=juce::Component::SafePointer<Main>(this);
        pool.addJob(new Job([safe,partial]{try{auto recovered=tonescope::desktop::recoverInterruptedCapture(partial);juce::MessageManager::callAsync([safe,recovered]{if(safe)safe->loadAudio(recovered);});}catch(const std::exception& e){auto message=juce::String(e.what());juce::MessageManager::callAsync([safe,message]{if(safe)safe->setStatus("Capture recovery failed: "+message);});}}),true);
    }

    void writeParameterControls(const tonescope::Parameters& p){
        for(auto& c:controls)c->slider.setValue(p.*(c->member),juce::dontSendNotification);
        oversampling=p.oversampling;multiband=p.multiband;stages[0].setToggleState(p.compressor,juce::dontSendNotification);stages[1].setToggleState(p.equalizer,juce::dontSendNotification);stages[2].setToggleState(p.drive,juce::dontSendNotification);
        constexpr std::array<std::array<int,3>,6> orders{{{0,1,2},{2,1,0},{1,0,2},{0,2,1},{1,2,0},{2,0,1}}};for(size_t i=0;i<orders.size();++i)if(orders[i]==p.order)order.setSelectedId((int)i+1,juce::dontSendNotification);
    }
    bool applyParameterTransaction(const tonescope::Parameters& p){
        std::string error;if(!tonescope::validate(p,source?source->sampleRate:deviceRate.load(),error)){setStatus("Parameter patch rejected: "+juce::String(error));return false;}
        const auto before=parameters();bool topology=before.order!=p.order||before.compressor!=p.compressor||before.equalizer!=p.equalizer||before.drive!=p.drive||before.oversampling!=p.oversampling||before.multiband!=p.multiband||before.crossoverLowHz!=p.crossoverLowHz||before.crossoverHighHz!=p.crossoverHighHz;
        writeParameterControls(p);parametersChanged(topology);return true;
    }
    void undoParameters(){tonescope::Parameters p;if(history.undo(p)){restoringParameters=true;applyParameterTransaction(p);restoringParameters=false;setStatus("Undid parameter transaction.");}else setStatus("No parameter change to undo.");}
    void redoParameters(){tonescope::Parameters p;if(history.redo(p)){restoringParameters=true;applyParameterTransaction(p);restoringParameters=false;setStatus("Redid parameter transaction.");}else setStatus("No parameter change to redo.");}


    void exportAudio(){

        if(!rendered||renderedRevision!=revision||busy||monitoring){setStatus("Stop live monitoring and wait for a current file render before exporting.");return;}

        chooser=std::make_unique<juce::FileChooser>("Export processed WAV and evidence",juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("tonescope-wet.wav"),"*.wav");auto safe=juce::Component::SafePointer<Main>(this);auto audio=rendered;auto state=session();

        chooser->launchAsync(juce::FileBrowserComponent::saveMode|juce::FileBrowserComponent::canSelectFiles|juce::FileBrowserComponent::warnAboutOverwriting,[safe,audio,state](const juce::FileChooser& f){if(!safe||f.getResult()==juce::File{})return;auto file=f.getResult();auto evidencePath=file.withFileExtension("evidence.json");if(evidencePath.exists()||evidencePath==safe->sourceFile){safe->setStatus("Evidence sidecar exists. Choose a new export name to preserve it.");return;}if(file==safe->sourceFile){safe->setStatus("Choose an export path different from the dry source.");return;}safe->setStatus("Exporting processed audio and comparison evidence...");safe->pool.addJob(new Job([safe,audio,state,file]{try{

                juce::TemporaryFile temp(file);tonescope::writeWav(temp.getFile().getFullPathName().toStdString(),*audio->exportWet);if(!temp.overwriteTargetFileWithTemporary())throw std::runtime_error("Could not replace output WAV.");

                auto* evidence=new juce::DynamicObject();evidence->setProperty("schema_version",1);evidence->setProperty("session",state);evidence->setProperty("source_rate_hz",audio->dry->sampleRate);evidence->setProperty("frames",(juce::int64)audio->dry->frames());evidence->setProperty("latency_samples",audio->latency);evidence->setProperty("rms_valid",audio->comparison.valid);evidence->setProperty("dry_rms",audio->comparison.dryRms);evidence->setProperty("wet_rms",audio->comparison.wetRms);evidence->setProperty("frozen_match_gain",audio->comparison.gain);evidence->setProperty("residual_rms",audio->comparison.residualRms);evidence->setProperty("export_semantics","Full-source float32 engine-output timeline; audition band filters, monitor RMS match, boundary fades and safety guard are excluded.");

                evidence->setProperty("comparison_band",state["ui"]["band"]);evidence->setProperty("comparison_alignment_samples",audio->latency);evidence->setProperty("comparison_filters","Identical branch audition filters at saved crossover frequencies; excluded from exported audio.");
                if(!file.withFileExtension("evidence.json").replaceWithText(juce::JSON::toString(juce::var(evidence))))throw std::runtime_error("WAV saved but evidence sidecar failed.");

                juce::MessageManager::callAsync([safe,file]{if(safe)safe->setStatus("Exported "+file.getFileName()+" and evidence JSON. Full source, raw processed gain.");});

            }catch(const std::exception& e){auto message=juce::String(e.what());juce::MessageManager::callAsync([safe,message]{if(safe)safe->setStatus("Export failed: "+message);});}}),true);});

    }

#if __has_include("AssistantIntegration.inc")
    #include "AssistantIntegration.inc"
#else
    void initialiseAssistant(){}
    void shutdownAssistant(){}
    void updateAssistant(){}
    void assistantSessionChanged(){}
#endif
};

class Application final : public juce::JUCEApplication {

public:

    const juce::String getApplicationName() override{return "ToneScope";}

    const juce::String getApplicationVersion() override{return "0.1.0";}

    bool moreThanOneInstanceAllowed() override{return false;}

    void initialise(const juce::String& commandLine) override {

        auto args=juce::StringArray::fromTokens(commandLine,true);args.removeEmptyStrings();
#if JUCE_WINDOWS
        if(args.contains("--web-ui-test")){auto debug=args.indexOf("--web-debug-port");if(debug>=0&&debug+1<args.size()&&args[debug+1].containsOnly("0123456789")){int port=args[debug+1].getIntValue();if(port>=1024&&port<=65535){auto flags="--remote-debugging-address=127.0.0.1 --remote-debugging-port="+juce::String(port);_putenv_s("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",flags.toRawUTF8());}}}
#endif
        window=std::make_unique<Window>(!args.contains("--screenshot")&&!args.contains("--web-ui-test"));

        if(args.contains("--demo"))static_cast<Main*>(window->getContentComponent())->loadSyntheticDemo();

        auto index=args.indexOf("--screenshot");

        if(index>=0&&index+1<args.size()&&juce::File::isAbsolutePath(args[index+1].unquoted())){

            auto destination=juce::File(args[index+1].unquoted());

            juce::Timer::callAfterDelay(1800,[this,destination]{if(window){auto image=window->getContentComponent()->createComponentSnapshot(window->getContentComponent()->getLocalBounds());if(auto stream=destination.createOutputStream()){juce::PNGImageFormat png;png.writeImageToStream(image,*stream);}}quit();});

        }

    }

    void shutdown() override {window.reset();}

    void systemRequestedQuit() override {quit();}

    class Window final : public juce::DocumentWindow {

    public:

        explicit Window(bool openAudio):DocumentWindow("ToneScope | audio microscope",Palette::get().background,DocumentWindow::allButtons){setUsingNativeTitleBar(true);setContentOwned(new Main(openAudio),true);setResizable(true,true);setResizeLimits(960,720,2560,1800);centreWithSize(getWidth(),getHeight());setVisible(true);}

        void closeButtonPressed() override {juce::JUCEApplication::getInstance()->systemRequestedQuit();}

    };

    std::unique_ptr<Window> window;

};

}

START_JUCE_APPLICATION(Application)
