#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform Buffer {
    mat4 qt_Matrix;
    float qt_Opacity;
    float cornerRadius;
    vec2 surfaceSize;
} uniforms;
layout(binding = 1) uniform sampler2D source;

void main()
{
    vec2 size = max(uniforms.surfaceSize, vec2(1.0));
    float radius = min(uniforms.cornerRadius, min(size.x, size.y) * 0.5);
    vec2 corner = abs(qt_TexCoord0 * size - size * 0.5) - (size * 0.5 - radius);
    float distance = length(max(corner, vec2(0.0)))
        + min(max(corner.x, corner.y), 0.0) - radius;
    float mask = 1.0 - smoothstep(-0.75, 0.75, distance);
    fragColor = texture(source, qt_TexCoord0) * mask * uniforms.qt_Opacity;
}
