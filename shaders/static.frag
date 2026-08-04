#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform Buffer {
    mat4 qt_Matrix;
    float qt_Opacity;
    float frame;
} uniforms;

float noise(vec2 cell)
{
    return fract(sin(dot(cell, vec2(12.9898, 78.233))
                     + uniforms.frame * 19.19) * 43758.5453);
}

void main()
{
    // A coarse grid reads as analogue snow after the CRT post-process while
    // keeping the fragment workload tiny on Raspberry Pi hardware.
    vec2 cell = floor(qt_TexCoord0 * vec2(240.0, 180.0));
    float value = 0.10 + noise(cell) * 0.64;
    float horizontalVariation = 0.94
        + 0.06 * sin((qt_TexCoord0.y * 180.0 + uniforms.frame) * 0.73);
    fragColor = vec4(vec3(value * horizontalVariation), 1.0) * uniforms.qt_Opacity;
}
