cmake_minimum_required(VERSION 3.24)

project(
    MabelTV
    VERSION 0.1.0
    DESCRIPTION "A child-friendly 1990s television experience"
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Qt6 6.4 REQUIRED COMPONENTS Core Gui Qml Quick OpenGL ShaderTools)
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
endif()

qt_standard_project_setup(REQUIRES 6.4)

add_library(mabeltv_core STATIC
    src/core/TvController.cpp
    src/core/TvController.h
    src/library/ChannelLibrary.cpp
    src/library/ChannelLibrary.h
    src/library/MediaIndex.cpp
    src/library/MediaIndex.h
    src/library/ShuffleBag.cpp
    src/library/ShuffleBag.h
)

target_include_directories(mabeltv_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(mabeltv_core PUBLIC Qt6::Core)

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
        qml/ParentOverlay.qml
)

qt_add_shaders(mabeltv "mabeltv_shaders"
    PREFIX "/shaders"
    BASE "shaders"
    FILES
        shaders/crt.frag
)

target_link_libraries(mabeltv PRIVATE
    mabeltv_core
    Qt6::Core
    Qt6::Gui
    Qt6::Qml
    Qt6::Quick
    Qt6::OpenGL
    ${MPV_LINK_LIBRARIES}
    ${MPV_LIBRARY}
)

target_include_directories(mabeltv PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    ${MPV_INCLUDE_DIRS}
    ${MPV_INCLUDE_DIR}
)

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

    qt_add_executable(mabeltv_core_tests
        tests/unit/CoreTests.cpp
    )
    target_link_libraries(mabeltv_core_tests PRIVATE mabeltv_core Qt6::Test)

    add_test(NAME mabeltv_core_tests COMMAND mabeltv_core_tests)
    add_test(NAME milestone0_libmpv_self_test COMMAND mabeltv --self-test)
    set_tests_properties(milestone0_libmpv_self_test PROPERTIES TIMEOUT 15)
endif()

install(TARGETS mabeltv
    RUNTIME DESTINATION .
    BUNDLE DESTINATION .
)
install(TARGETS mabeltv_media_check RUNTIME DESTINATION .)
