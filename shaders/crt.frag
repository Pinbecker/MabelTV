#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform Buffer {
    mat4 qt_Matrix;
    float qt_Opacity;
    float flicker;
    float effectStrength;
    vec2 resolution;
} uniforms;

layout(binding = 1) uniform sampler2D source;

float roundedScreenMask(vec2 centered)
{
    float aspect = uniforms.resolution.x / max(1.0, uniforms.resolution.y);
    vec2 point = centered * vec2(aspect, 1.0);
    vec2 halfSize = vec2(aspect, 1.0);
    float radius = 0.065;
    vec2 distanceToCorner = abs(point) - (halfSize - vec2(radius));
    float distanceToEdge = length(max(distanceToCorner, vec2(0.0)))
        + min(max(distanceToCorner.x, distanceToCorner.y), 0.0) - radius;
    return 1.0 - smoothstep(-0.006, 0.006, distanceToEdge);
}

void main()
{
    vec2 centered = qt_TexCoord0 * 2.0 - 1.0;
    float curve = 1.0 + 0.007 * uniforms.effectStrength * dot(centered, centered);
    vec2 sampleUv = centered * curve * 0.5 + 0.5;
    float mask = roundedScreenMask(centered);

    if (mask <= 0.0 || sampleUv.x < 0.0 || sampleUv.x > 1.0
        || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
        fragColor = vec4(0.0);
        return;
    }

    vec2 pixel = 1.0 / max(uniforms.resolution, vec2(1.0));
    vec4 centreSample = texture(source, sampleUv);
    vec4 leftSample = texture(source, sampleUv - vec2(pixel.x, 0.0));
    vec4 rightSample = texture(source, sampleUv + vec2(pixel.x, 0.0));
    float softness = 0.07 * uniforms.effectStrength;
    vec3 colour = centreSample.rgb * (1.0 - softness * 2.0)
        + (leftSample.rgb + rightSample.rgb) * softness;
    colour.r = mix(colour.r, rightSample.r, 0.025 * uniforms.effectStrength);
    colour.b = mix(colour.b, leftSample.b, 0.025 * uniforms.effectStrength);

    float scanline = 1.0 - 0.035 * uniforms.effectStrength
        * (0.5 + 0.5 * sin(sampleUv.y * uniforms.resolution.y * 3.14159265));
    float vignette = 1.0 - 0.09 * uniforms.effectStrength
        * smoothstep(0.38, 1.25, length(centered));
    float analogueVariation = 1.0
        - uniforms.flicker * uniforms.effectStrength * 0.005;
    colour *= scanline * vignette * analogueVariation;

    fragColor = vec4(colour, centreSample.a * mask) * uniforms.qt_Opacity;
}
