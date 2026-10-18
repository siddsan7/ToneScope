#if TONESCOPE_WEB_FRONTEND
    std::unique_ptr<ToneScopeBrowser> browser;
    std::function<juce::var(juce::String,juce::var)> assistantCommand;
    juce::var webSnapshot() const {
        auto* object=new juce::DynamicObject();juce::var state(object);
        auto put=[&](const juce::Identifier& key,const juce::var& value){object->setProperty(key,value);};
        if(assistantCommand)put("assistant",assistantCommand("assistant.status",{}));
        put("latency",rendered?rendered->latency:0);put("oversampling",oversampling);put("multiband",multiband);put("band",auditionBand);put("version",1);put("revision",(juce::int64)revision);put("renderedRevision",(juce::int64)renderedRevision);
        put("source",sourceFile.existsAsFile()?sourceFile.getFileName():(source?"Captured / demo take":""));
        put("duration",source?source->frames()/source->sampleRate:0);put("sampleRate",source?source->sampleRate:deviceRate.load());put("channels",source?(int)source->samples.size():0);
        put("status",status.getText());put("metrics",metrics.getText());put("playing",playing.load());put("monitoring",monitoring.load());put("recording",recording.load());put("looping",looping.load());put("matching",match.getToggleState());put("busy",busy);put("ready",rendered&&renderedRevision==revision&&!busy);put("mode",mode.getSelectedId());put("order",order.getSelectedId());
        put("canUndo",history.canUndo());put("canRedo",history.canRedo());put("captureFinalizing",captureFinalizing);put("dryReference","ingress-clamped and smoothed input trim; recorded dry source precedes trim");
        put("position",rendered?position.load()/juce::jmax<int64_t>(1,rendered->dry->frames()):0);
        juce::Array<juce::var> selection;selection.add(scope.first);selection.add(scope.last);put("selection",selection);
        juce::Array<juce::var> stageValues;for(auto& stage:stages)stageValues.add(stage.getToggleState());put("stages",stageValues);
        juce::Array<juce::var> params;
        for(auto& c:controls){auto* p=new juce::DynamicObject();p->setProperty("key",c->key);p->setProperty("label",c->label.getText());p->setProperty("min",c->slider.getMinimum());p->setProperty("max",c->slider.getMaximum());p->setProperty("value",c->slider.getValue());p->setProperty("unit",c->slider.getTextValueSuffix().trim());params.add(juce::var(p));}put("controls",params);
        auto array=[](const auto& values){juce::Array<juce::var> result;for(auto v:values)result.add((double)v);return result;};
        put("dryPeaks",rendered?array(rendered->dryPeaks):juce::Array<juce::var>{});put("wetPeaks",rendered?array(rendered->wetPeaks):juce::Array<juce::var>{});
        // Resample the measured linear FFT into logarithmic frequency bins. Never
        // draw a decorative curve or interpolate fabricated audio measurements.
        auto logSpectrum=[&](const std::vector<double>& values){juce::Array<juce::var> result;if(values.empty()||!rendered)return result;for(int i=0;i<256;++i){double hz=20*std::pow(1000.0,i/255.0);auto k=juce::jlimit<size_t>(0,values.size()-1,(size_t)std::llround(hz/rendered->dry->sampleRate*2*(values.size()-1)));result.add(20*std::log10(juce::jmax(1.0e-8,values[k])));}return result;};
        auto envelope=[&](const std::vector<tonescope::DynamicsFrame>& frames){juce::Array<juce::var> result;for(size_t i=0;i<frames.size();i+=juce::jmax<size_t>(1,frames.size()/256))result.add(20*std::log10(juce::jmax(1.0e-8,frames[i].envelopeRms)));return result;};
        put("dryEnvelope",rendered?envelope(rendered->dryDynamics):juce::Array<juce::var>{});put("wetEnvelope",rendered?envelope(rendered->wetDynamics):juce::Array<juce::var>{});
        put("drySpectrum",rendered?logSpectrum(rendered->drySpectrum):juce::Array<juce::var>{});put("wetSpectrum",rendered?logSpectrum(rendered->wetSpectrum):juce::Array<juce::var>{});return state;
    }
    void webCommand(const juce::Array<juce::var>& arguments,juce::WebBrowserComponent::NativeFunctionCompletion complete){
        if(arguments.size()!=1||!arguments[0].isObject()){setStatus("Invalid frontend command.");complete(webSnapshot());return;}
        const auto input=arguments[0];auto action=input["action"].toString();
        if(!input["version"].isInt()||(int)input["version"]!=1){setStatus("Unsupported frontend protocol version.");complete(webSnapshot());return;}
        auto number=[&](const char* key){auto value=input[key];return (value.isInt()||value.isInt64()||value.isDouble())&&std::isfinite((double)value);};
        auto toggle=[&](juce::ToggleButton& button){if(input["value"].isBool())button.setToggleState((bool)input["value"],juce::sendNotificationSync);else setStatus("Expected a boolean control value.");};
        if(action=="snapshot"){}
        else if(action=="undo")undoParameters();else if(action=="redo")redoParameters();else if(action=="recover")restoreRecovery();
        else if(action=="assistant.ask"||action=="assistant.cancel"||action=="assistant.status"||action=="assistant.preview"||action=="assistant.apply"||action=="assistant.dismiss"||action=="assistant.history.delete"){if(assistantCommand)assistantCommand(action,input);else setStatus("Assistant service unavailable. No request was sent.");}
        else if(action=="import")chooseImport();else if(action=="open")openSession();else if(action=="save")saveSession();else if(action=="export")exportAudio();else if(action=="devices")showDevices();else if(action=="play")togglePlay();else if(action=="pause")playing=false;else if(action=="rewind"){playing=false;position=selectionStart.load();}
        else if(action=="quality"&&input["value"].isInt()&&((int)input["value"]==1||(int)input["value"]==2||(int)input["value"]==4)){oversampling=(int)input["value"];parametersChanged(true);}
        else if(action=="multiband"&&input["value"].isBool()){multiband=(bool)input["value"];parametersChanged(true);}
        else if(action=="band"&&input["value"].isInt()&&(int)input["value"]>=0&&(int)input["value"]<=3){auditionBand=(int)input["value"];requestRender();}
        else if(action=="capture")toggleCapture();else if(action=="live")toggle(live);else if(action=="loop")toggle(loop);else if(action=="match")toggle(match);
        else if(action=="mode"&&input["value"].isInt()&&(int)input["value"]>=1&&(int)input["value"]<=4)mode.setSelectedId((int)input["value"],juce::sendNotificationSync);
        else if(action=="order"&&input["value"].isInt()&&(int)input["value"]>=1&&(int)input["value"]<=6)order.setSelectedId((int)input["value"],juce::sendNotificationSync);
        else if(action=="stage"&&input["index"].isInt()&&(int)input["index"]>=0&&(int)input["index"]<3)toggle(stages[(size_t)(int)input["index"]]);
        else if(action=="selection"&&number("from")&&number("to")&&(double)input["from"]>=0&&(double)input["to"]<=1&&(double)input["from"]<(double)input["to"])setSelection((double)input["from"],(double)input["to"]);
        else if(action=="seek"&&number("value")&&(double)input["value"]>=0&&(double)input["value"]<=1)seek.setValue((double)input["value"],juce::sendNotificationSync);
        else if(action=="parameter"&&number("value")){bool found=false;for(auto& c:controls)if(c->key==input["key"].toString()){found=true;auto value=(double)input["value"];if(value>=c->slider.getMinimum()&&value<=c->slider.getMaximum())c->slider.setValue(value,juce::sendNotificationSync);else setStatus("Parameter outside its valid range.");break;}if(!found)setStatus("Unknown parameter.");}
        else setStatus("Invalid or unknown frontend command.");
        complete(webSnapshot());
    }
    void initialiseWebFrontend(){
        auto options=juce::WebBrowserComponent::Options{}.withBackend(juce::WebBrowserComponent::Options::Backend::webview2).withNativeIntegrationEnabled().withNativeFunction("tonescopeCommand",[this](const auto& args,auto complete){webCommand(args,std::move(complete));}).withResourceProvider([](const juce::String& path)->std::optional<juce::WebBrowserComponent::Resource>{
            const char* data=nullptr;int size=0;juce::String mime;
            if(path=="/"||path=="/index.html"){data=ToneScopeWeb::index_html;size=ToneScopeWeb::index_htmlSize;mime="text/html";}
            else if(path=="/index.js"){data=ToneScopeWeb::index_js;size=ToneScopeWeb::index_jsSize;mime="text/javascript";}
            else if(path=="/index.css"){data=ToneScopeWeb::index_css;size=ToneScopeWeb::index_cssSize;mime="text/css";}
            else if(path=="/fonts/SpaceGrotesk.ttf"){data=ToneScopeWeb::SpaceGrotesk_ttf;size=ToneScopeWeb::SpaceGrotesk_ttfSize;mime="font/ttf";}
            else if(path=="/fonts/CommitMono.otf"){data=ToneScopeWeb::CommitMono_otf;size=ToneScopeWeb::CommitMono_otfSize;mime="font/otf";}
            if(!data)return std::nullopt;std::vector<std::byte> bytes((size_t)size);std::memcpy(bytes.data(),data,(size_t)size);return juce::WebBrowserComponent::Resource{std::move(bytes),mime};
        });
        if(!juce::WebBrowserComponent::areOptionsSupported(options)){setStatus("WebView2 runtime unavailable. Using the native interface; audio remains local.");return;}
        browser=std::make_unique<ToneScopeBrowser>(options);addAndMakeVisible(*browser);browser->setBounds(getLocalBounds());browser->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
    }
#endif
