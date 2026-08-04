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
    float curve = 1.0 + 0.007 * uniforms.effectStrength * dot(centered, centered);
    // Bend the contents within the fixed rounded screen instead of expanding
    // them beyond the texture. Expanding created a second transparent edge
    // that became squarer and more obvious as CRT Glass increased.
    vec2 sampleUv = centered / curve * 0.5 + 0.5;
    float mask = roundedScreenMask(qt_TexCoord0);
    float distortion = clamp(uniforms.distortion, 0.0, 1.0);

    float trackingPosition = fract(uniforms.phase * 0.075);
    float trackingDistance = abs(sampleUv.y - trackingPosition);
    trackingDistance = min(trackingDistance, 1.0 - trackingDistance);
    float trackingBand = 1.0 - smoothstep(0.006, 0.034, trackingDistance);
    float horizontalWobble = sin(sampleUv.y * 31.0 + uniforms.phase * 4.7)
        + 0.45 * sin(sampleUv.y * 83.0 - uniforms.phase * 7.1);
    sampleUv.x += horizontalWobble * 0.0018 * distortion;
    sampleUv.x += trackingBand * sin(uniforms.phase * 11.0) * 0.016
        * distortion * distortion;
    sampleUv.y += sin(uniforms.phase * 3.3) * 0.0012 * distortion;

    if (mask <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }

    vec2 pixel = 1.0 / max(uniforms.resolution, vec2(1.0));
    sampleUv = clamp(sampleUv, pixel * 0.5, vec2(1.0) - pixel * 0.5);
    vec4 centreSample = texture(source, sampleUv);
    vec4 leftSample = texture(source, sampleUv - vec2(pixel.x, 0.0));
    vec4 rightSample = texture(source, sampleUv + vec2(pixel.x, 0.0));
    float softness = 0.07 * uniforms.effectStrength;
    vec3 colour = centreSample.rgb * (1.0 - softness * 2.0)
        + (leftSample.rgb + rightSample.rgb) * softness;
    colour.r = mix(colour.r, rightSample.r, 0.025 * uniforms.effectStrength);
    colour.b = mix(colour.b, leftSample.b, 0.025 * uniforms.effectStrength);

    if (distortion > 0.001) {
        float colourOffset = (0.5 + 4.5 * distortion * distortion) * pixel.x;
        vec3 separatedColour = vec3(
            texture(source, sampleUv + vec2(colourOffset, 0.0)).r,
            centreSample.g,
            texture(source, sampleUv - vec2(colourOffset, 0.0)).b);
        colour = mix(colour, separatedColour, 0.58 * distortion);

        float grain = analogueNoise(sampleUv * uniforms.resolution
                                     + vec2(uniforms.phase * 31.0));
        colour += (grain - 0.5) * 0.085 * distortion;
        colour *= 1.0 + trackingBand * 0.14 * distortion;
    }

    float scanline = 1.0 - 0.035 * uniforms.effectStrength
        * (0.5 + 0.5 * sin(sampleUv.y * uniforms.resolution.y * 3.14159265));
    float vignette = 1.0 - 0.09 * uniforms.effectStrength
        * smoothstep(0.38, 1.25, length(centered));
    float analogueVariation = 1.0
        - uniforms.flicker * uniforms.effectStrength * 0.005;
    colour *= scanline * vignette * analogueVariation;

    fragColor = vec4(colour, centreSample.a * mask) * uniforms.qt_Opacity;
}
