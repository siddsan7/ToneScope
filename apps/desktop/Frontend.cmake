# Include from root CMake after juce_add_gui_app(ToneScope...).
find_program(TONESCOPE_NPM npm.cmd REQUIRED)
set(TONESCOPE_FRONTEND "${CMAKE_SOURCE_DIR}/apps/frontend")
set(TONESCOPE_WEB_FILES "${TONESCOPE_FRONTEND}/dist/index.html" "${TONESCOPE_FRONTEND}/dist/index.js" "${TONESCOPE_FRONTEND}/dist/index.css" "${TONESCOPE_FRONTEND}/dist/fonts/SpaceGrotesk.ttf" "${TONESCOPE_FRONTEND}/dist/fonts/CommitMono.otf")
file(GLOB_RECURSE TONESCOPE_WEB_SOURCES CONFIGURE_DEPENDS "${TONESCOPE_FRONTEND}/src/*")
add_custom_command(OUTPUT ${TONESCOPE_WEB_FILES}
 COMMAND "${TONESCOPE_NPM}" ci --ignore-scripts
 COMMAND "${TONESCOPE_NPM}" run build
 WORKING_DIRECTORY "${TONESCOPE_FRONTEND}"
 DEPENDS ${TONESCOPE_WEB_SOURCES} "${TONESCOPE_FRONTEND}/package.json" "${TONESCOPE_FRONTEND}/package-lock.json" "${TONESCOPE_FRONTEND}/vite.config.ts" "${TONESCOPE_FRONTEND}/index.html"
 VERBATIM)
add_custom_target(tonescope_frontend DEPENDS ${TONESCOPE_WEB_FILES})
set_source_files_properties(${TONESCOPE_WEB_FILES} PROPERTIES GENERATED TRUE)
juce_add_binary_data(tonescope_web HEADER_NAME ToneScopeWeb.h NAMESPACE ToneScopeWeb SOURCES ${TONESCOPE_WEB_FILES})
add_dependencies(tonescope_web tonescope_frontend)
target_link_libraries(ToneScope PRIVATE tonescope_web juce::juce_gui_extra)
target_compile_definitions(ToneScope PRIVATE TONESCOPE_WEB_FRONTEND=1 JUCE_WEB_BROWSER=1 JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
set_property(TARGET ToneScope PROPERTY JUCE_NEEDS_WEBVIEW2 TRUE)
