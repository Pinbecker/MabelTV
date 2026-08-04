#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform Buffer {
    mat4 qt_Matrix;
    float qt_Opacity;
    float flicker;
    float effectStrength;
    float distortion;
    float phase;
    float cornerRadius;
    float maskSoftness;
    vec2 resolution;
} uniforms;

layout(binding = 1) uniform sampler2D source;

float roundedScreenMask(vec2 uv)
{
    vec2 halfSize = uniforms.resolution * 0.5 - vec2(0.75);
    float radius = clamp(uniforms.cornerRadius,
                         0.0,
                         max(0.0, min(halfSize.x, halfSize.y) - 1.0));
    vec2 point = abs((uv - vec2(0.5)) * uniforms.resolution);
    vec2 cornerDistance = point - halfSize + vec2(radius);
    float signedDistance = min(max(cornerDistance.x, cornerDistance.y), 0.0)
        + length(max(cornerDistance, vec2(0.0))) - radius;
    float softness = max(0.75, uniforms.maskSoftness);
    return 1.0 - smoothstep(-softness, softness, signedDistance);
}

float analogueNoise(vec2 point)
{
    return fract(sin(dot(point, vec2(12.9898, 78.233)) + uniforms.phase * 19.19)
                 * 43758.5453);
}

void main()
{
    vec2 centered = qt_TexCoord0 * 2.0 - 1.0;
    float glass = clamp(uniforms.effectStrength, 0.0, 1.0);
    float glassCurve = pow(glass, 1.25);
    float curve = 1.0 + 0.040 * glassCurve * dot(centered, centered);
    // Bend the contents within the fixed rounded screen instead of expanding
    // them beyond the texture. Expanding created a second transparent edge
    // that became squarer and more obvious as CRT Glass increased.
    vec2 sampleUv = centered / curve * 0.5 + 0.5;
    float mask = roundedScreenMask(qt_TexCoord0);
    float distortion = clamp(uniforms.distortion, 0.0, 1.0);

    // Motion is deliberately reserved for the very top of the distortion
    // control. Lower settings add age and haze without making the image swim.
    float wobbleAmount = smoothstep(0.94, 1.0, distortion);
    float horizontalWobble = sin(sampleUv.y * 31.0 + uniforms.phase * 4.7)
        + 0.45 * sin(sampleUv.y * 83.0 - uniforms.phase * 7.1);
    sampleUv.x += horizontalWobble * 0.00032 * wobbleAmount;
    sampleUv.y += sin(uniforms.phase * 3.3) * 0.00012 * wobbleAmount;

    if (mask <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }

    vec2 pixel = 1.0 / max(uniforms.resolution, vec2(1.0));
    vec2 sampleMinimum = pixel * 0.5;
    vec2 sampleMaximum = vec2(1.0) - sampleMinimum;
    sampleUv = clamp(sampleUv, sampleMinimum, sampleMaximum);
    vec4 centreSample = texture(source, sampleUv);
    vec4 leftSample = texture(source,
                              clamp(sampleUv - vec2(pixel.x, 0.0),
                                    sampleMinimum,
                                    sampleMaximum));
    vec4 rightSample = texture(source,
                               clamp(sampleUv + vec2(pixel.x, 0.0),
                                     sampleMinimum,
                                     sampleMaximum));
    float softness = 0.025 * glass + 0.14 * distortion;
    vec3 colour = centreSample.rgb * (1.0 - softness * 2.0)
        + (leftSample.rgb + rightSample.rgb) * softness;
    colour.r = mix(colour.r, rightSample.r, 0.012 * glass);
    colour.b = mix(colour.b, leftSample.b, 0.012 * glass);

    if (distortion > 0.001) {
        float colourOffset = (0.5 + 3.5 * distortion * distortion) * pixel.x;
        vec3 separatedColour = vec3(
            texture(source,
                    clamp(sampleUv + vec2(colourOffset, 0.0),
                          sampleMinimum,
                          sampleMaximum)).r,
            centreSample.g,
            texture(source,
                    clamp(sampleUv - vec2(colourOffset, 0.0),
                          sampleMinimum,
                          sampleMaximum)).b);
        colour = mix(colour, separatedColour, 0.44 * distortion);

        float grain = analogueNoise(sampleUv * uniforms.resolution
                                     + vec2(uniforms.phase * 31.0));
        float coarseGrain = analogueNoise(floor(sampleUv * uniforms.resolution / 5.0)
                                          + vec2(uniforms.phase * 7.0));
        colour += (grain - 0.5) * 0.105 * distortion;
        colour += (coarseGrain - 0.5) * 0.035 * distortion * distortion;
        float luminance = dot(colour, vec3(0.299, 0.587, 0.114));
        colour = mix(colour, vec3(luminance), 0.075 * distortion);
        colour = mix(colour, colour * 0.88 + vec3(0.055),
                     0.15 * distortion);
    }

    float scanline = 1.0 - (0.018 * glass + 0.055 * distortion)
        * (0.5 + 0.5 * sin(sampleUv.y * uniforms.resolution.y * 3.14159265));
    float vignette = 1.0 - 0.18 * glassCurve
        * smoothstep(0.38, 1.25, length(centered));
    float cornerDepth = pow(abs(centered.x * centered.y), 1.35);
    float glassDepth = 1.0 - 0.13 * glassCurve * cornerDepth;
    float analogueVariation = 1.0
        - uniforms.flicker * (0.001 * glass + 0.003 * distortion);
    colour *= scanline * vignette * glassDepth * analogueVariation;

    fragColor = vec4(colour, centreSample.a * mask) * uniforms.qt_Opacity;
}
