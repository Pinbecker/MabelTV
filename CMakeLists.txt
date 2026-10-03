cmake_minimum_required(VERSION 3.24)

project(
    MabelTV
    VERSION 0.2.5
    DESCRIPTION "KidsTV: a child-friendly 1990s television experience"
    LANGUAGES CXX
)

option(MABELTV_PI_APPLIANCE "Build the systemd-notify Raspberry Pi appliance" OFF)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Qt6 6.4 REQUIRED COMPONENTS Core Gui Qml Quick OpenGL ShaderTools Concurrent Network Sql)
set(MPV_INCLUDE_DIRS "")
set(MPV_LINK_LIBRARIES "")
if(WIN32 AND DEFINED ENV{MABELTV_MSYS2_ROOT})
    file(TO_CMAKE_PATH "$ENV{MABELTV_MSYS2_ROOT}/ucrt64" MABELTV_UCRT_ROOT)
    find_path(MPV_INCLUDE_DIR
        NAMES mpv/client.h
        PATHS "${MABELTV_UCRT_ROOT}/include"
        NO_DEFAULT_PATH
        REQUIRED
    )
    find_library(MPV_LIBRARY
        NAMES mpv libmpv
        PATHS "${MABELTV_UCRT_ROOT}/lib"
        NO_DEFAULT_PATH
        REQUIRED
    )
else()
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(MPV REQUIRED mpv)
    pkg_check_modules(SYSTEMD QUIET libsystemd)
endif()

if(MABELTV_PI_APPLIANCE AND NOT SYSTEMD_FOUND)
    message(FATAL_ERROR "A Raspberry Pi appliance build requires libsystemd development files")
endif()

qt_standard_project_setup(REQUIRES 6.4)

add_library(mabeltv_core STATIC
    src/core/TvController.cpp
    src/core/TvControllerActions.cpp
    src/core/TvController.h
    src/core/TvControllerFormatting.h
    src/core/TvControllerPersistence.cpp
    src/core/TvControllerPlayback.cpp
    src/core/TvControllerPortal.cpp
    src/core/StateDatabase.cpp
    src/core/MabelQueueState.cpp
    src/core/TvControllerQueue.cpp
    src/core/StateDatabase.h
    src/ipc/PortalControlServer.cpp
    src/ipc/PortalControlServer.h
    src/hardware/CecTvControl.cpp
    src/hardware/CecTvControl.h
    src/library/ChannelLibrary.cpp
    src/library/ChannelLibrary.h
    src/library/MediaIndex.cpp
    src/library/MediaIndex.h
    src/library/ShuffleBag.cpp
    src/library/ShuffleBag.h
)

target_include_directories(mabeltv_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(mabeltv_core PUBLIC Qt6::Core Qt6::Concurrent Qt6::Network Qt6::Sql)

if(MSVC)
    target_compile_options(mabeltv_core PRIVATE /W4 /permissive-)
else()
    target_compile_options(mabeltv_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

qt_add_executable(mabeltv WIN32
    src/app/main.cpp
    src/diagnostics/Logging.cpp
    src/diagnostics/Logging.h
    src/media/MpvVideo.cpp
    src/media/MpvVideo.h
    src/media/SoundEffects.cpp
    src/media/SoundEffects.h
)

qt_add_executable(mabeltv_media_check
    src/tools/media-check.cpp
)
target_link_libraries(mabeltv_media_check PRIVATE mabeltv_core Qt6::Core)

qt_add_resources(mabeltv "mabeltv_qml"
    PREFIX "/"
    FILES
        qml/Main.qml
        qml/TelevisionScreen.qml
        qml/MabelQueueDoneScreen.qml
        qml/MabelQueueCoordinator.qml
        qml/DinosaurDenSurround.qml
        qml/FindingNemo.qml
        qml/FindingNemoBubbles.qml
        qml/OceanClubSurround.qml
        qml/OceanClownfishArt.qml
        qml/OceanJellyfishArt.qml
        qml/OceanSeahorseArt.qml
        qml/OceanSharkArt.qml
        qml/OceanStarfishArt.qml
        qml/OceanTurtleArt.qml
        qml/RemoteInputHandler.qml
        qml/ChannelSummaryOverlay.qml
        qml/TvGuideOverlay.qml
        qml/MabelChannelArtwork.qml
        qml/ParentOverlay.qml
        qml/ClassicParentOverlay.qml
        qml/ModernParentOverlay.qml
        qml/ParentConfirmationView.qml
        qml/ParentDashboardView.qml
        qml/ParentChannelSettings.qml
        qml/SignalIcon.qml
        qml/MyTvModeOverlay.qml
        qml/MyTvLibraryView.qml
        qml/MyTvMabelBrowse.qml
        qml/MyTvArtwork.qml
        qml/MyTvRoundedClip.qml
        qml/MyTvText.qml
        qml/MyTvControl.qml
        qml/MyTvIcon.qml
        qml/MyTvHint.qml
        qml/MyTvArtworkQueue.qml
        qml/MyTvBrowseRow.qml
        qml/MyTvCard.qml
        qml/MyTvProviderIcon.qml
        qml/MyTvDetailView.qml
        qml/MyTvKeyboard.qml
        qml/MabelPresentation.qml
        qml/MyTvPlaybackControls.qml
        qml/MyTvEpisodePlayback.qml
        qml/MyTvNextEpisode.qml
)

qt_add_resources(mabeltv "my_tv_visual_assets"
    PREFIX "/" BASE "assets" FILES
        assets/fonts/inter/InterVariable.ttf
        assets/fonts/inter/LICENSE.txt
        assets/icons/my-tv/play.svg
        assets/icons/my-tv/restart.svg
        assets/icons/my-tv/back.svg
        assets/icons/my-tv/search.svg
        assets/icons/my-tv/chevron.svg
        assets/icons/my-tv/subtitles.svg
)

qt_add_shaders(mabeltv "mabeltv_shaders"
    PREFIX "/shaders"
    BASE "shaders"
    FILES
        shaders/crt.frag
        shaders/my-tv-rounded.frag
)

target_link_libraries(mabeltv PRIVATE
    mabeltv_core
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::OpenGL
    Qt6::Network
    ${MPV_LINK_LIBRARIES}
    ${MPV_LIBRARY}
)

target_include_directories(mabeltv PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    ${MPV_INCLUDE_DIRS}
    ${MPV_INCLUDE_DIR}
)

if(SYSTEMD_FOUND)
    target_compile_definitions(mabeltv PRIVATE MABELTV_HAVE_SYSTEMD=1)
    target_include_directories(mabeltv PRIVATE ${SYSTEMD_INCLUDE_DIRS})
    target_link_libraries(mabeltv PRIVATE ${SYSTEMD_LINK_LIBRARIES})
endif()

target_compile_definitions(mabeltv PRIVATE
    MABELTV_VERSION="${PROJECT_VERSION}"
)

if(MSVC)
    target_compile_options(mabeltv PRIVATE /W4 /permissive-)
else()
    target_compile_options(mabeltv PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
if(BUILD_TESTING)
    find_package(Qt6 6.4 REQUIRED COMPONENTS Test)
    find_package(Python3 REQUIRED COMPONENTS Interpreter)

    qt_add_executable(mabeltv_core_tests
        tests/unit/CoreTests.cpp
        tests/unit/CoreTests.h
        tests/unit/QueueTests.cpp
        tests/unit/TestStateFixture.cpp
        tests/unit/TestStateFixture.h
    )
    target_link_libraries(mabeltv_core_tests PRIVATE mabeltv_core Qt6::Test)

    add_test(NAME mabeltv_core_tests COMMAND mabeltv_core_tests)
    qt_add_executable(mabeltv_native_ui_tests tests/unit/NativeMyTvTests.cpp)
    target_link_libraries(mabeltv_native_ui_tests PRIVATE mabeltv_core Qt6::Test Qt6::Quick Qt6::Qml)
    target_compile_definitions(mabeltv_native_ui_tests PRIVATE TEST_QML_DIR="${CMAKE_CURRENT_SOURCE_DIR}/qml")
    qt_add_shaders(mabeltv_native_ui_tests "my_tv_test_shaders"
        PREFIX "/shaders" BASE "shaders" FILES shaders/my-tv-rounded.frag)
    qt_add_resources(mabeltv_native_ui_tests "my_tv_test_assets"
        PREFIX "/" BASE "assets" FILES
            assets/fonts/inter/InterVariable.ttf
            assets/icons/my-tv/play.svg
            assets/icons/my-tv/restart.svg
            assets/icons/my-tv/back.svg
            assets/icons/my-tv/search.svg
            assets/icons/my-tv/chevron.svg
            assets/icons/my-tv/subtitles.svg)
    add_test(NAME mabeltv_native_ui_tests COMMAND mabeltv_native_ui_tests)
    set_tests_properties(mabeltv_native_ui_tests PROPERTIES
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen;QT_QUICK_BACKEND=software" TIMEOUT 30)
    add_test(
        NAME mabeltv_library_service_tests
        COMMAND "${Python3_EXECUTABLE}" -m unittest discover
                -s "${CMAKE_CURRENT_SOURCE_DIR}/tests/python"
                -t "${CMAKE_CURRENT_SOURCE_DIR}"
                -p "test_*.py"
    )
    find_program(NODE_EXECUTABLE node REQUIRED)
    add_test(
        NAME mabeltv_javascript_source_syntax
        COMMAND "${NODE_EXECUTABLE}" --test
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/js/test-source-syntax.mjs"
    )
    add_test(
        NAME mabeltv_offline_service_worker_tests
        COMMAND "${NODE_EXECUTABLE}" --test
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/js/test-offline-service-worker.mjs"
    )
    add_test(
        NAME mabeltv_matter_socket_tests
        COMMAND "${NODE_EXECUTABLE}" --test
                "${CMAKE_CURRENT_SOURCE_DIR}/integrations/matter/mabeltv-power-socket.test.mjs"
    )
    add_test(NAME milestone0_libmpv_self_test COMMAND mabeltv --self-test)
    set_tests_properties(milestone0_libmpv_self_test PROPERTIES TIMEOUT 15)
endif()

install(TARGETS mabeltv
    RUNTIME DESTINATION .
    BUNDLE DESTINATION .
)
install(TARGETS mabeltv_media_check RUNTIME DESTINATION .)
