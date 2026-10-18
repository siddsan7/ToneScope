// The web view is a presentation layer. All commands execute on JUCE's message
// thread; DSP state still crosses the pre-existing bounded audio command queue.
#if TONESCOPE_WEB_FRONTEND
class ToneScopeBrowser final : public juce::WebBrowserComponent {
public:
    using juce::WebBrowserComponent::WebBrowserComponent;
    bool pageAboutToLoad(const juce::String& url) override { return url.startsWith(getResourceProviderRoot()); }
    void newWindowAttemptingToLoad(const juce::String&) override {}
};
#endif
