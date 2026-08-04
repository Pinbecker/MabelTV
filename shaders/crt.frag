#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform Buffer {
    mat4 qt_Matrix;
    float qt_Opacity;
    float flicker;
    float effectStrength;
    float distortion;
    float pausedEffect;
    float phase;
    float cornerRadius;
    float maskSoftness;
    vec2 resolution;
} uniforms;

layout(binding = 1) uniform sampler2D source;

float roundedScreenMask(vec2 uv)
{
    vec2 point = abs(uv * 2.0 - 1.0);
    float glass = clamp(uniforms.effectStrength, 0.0, 1.0);
    // A superellipse bows every edge outward like the glass in the Mabel TV
    // welcome film. Higher glass settings move from a modern rounded rectangle
    // towards the visibly convex face of a deep CRT tube.
    float exponent = mix(7.0, 4.0, pow(glass, 0.8));
    float shape = pow(point.x, exponent) + pow(point.y, exponent);
    float softness = max(0.0015, uniforms.maskSoftness * 2.2
        / max(1.0, min(uniforms.resolution.x, uniforms.resolution.y)));
    return 1.0 - smoothstep(1.0 - softness, 1.0 + softness, shape);
}

float analogueNoise(vec2 point)
{
    return fract(sin(dot(point, vec2(12.9898, 78.233)) + uniforms.phase * 19.19)
                 * 43758.5453);
}

float frameNoise(vec2 point)
{
    return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453);
}

void main()
{
    vec2 centered = qt_TexCoord0 * 2.0 - 1.0;
    float glass = clamp(uniforms.effectStrength, 0.0, 1.0);
    float glassCurve = pow(glass, 1.25);
    float curveAmount = 0.044 * glassCurve;
    float curve = 1.0 + curveAmount * dot(centered, centered);
    // Barrel distortion is the convex direction. Dividing here produced the
    // concave/pincushion look. Normalising by the corner maximum retains the
    // convex bend while keeping every sample inside the source texture.
    vec2 sampleUv = centered * curve / (1.0 + curveAmount * 2.0) * 0.5 + 0.5;
    float mask = roundedScreenMask(qt_TexCoord0);
    float distortion = clamp(uniforms.distortion, 0.0, 1.0);

    // Motion is deliberately reserved for the very top of the distortion
    // control. Lower settings add age and haze without making the image swim.
    float wobbleAmount = smoothstep(0.94, 1.0, distortion);
    float horizontalWobble = sin(sampleUv.y * 31.0 + uniforms.phase * 4.7)
        + 0.45 * sin(sampleUv.y * 83.0 - uniforms.phase * 7.1);
    sampleUv.x += horizontalWobble * 0.00032 * wobbleAmount;
    sampleUv.y += sin(uniforms.phase * 3.3) * 0.00012 * wobbleAmount;

    float paused = clamp(uniforms.pausedEffect, 0.0, 1.0);
    if (paused > 0.001) {
        // A paused tape should look electrically unstable without making the
        // whole picture swim. Quantise the noise to broad horizontal rows and
        // a low frame rate, then reserve the larger offset for one fixed
        // head-switching band near the bottom of the picture.
        float pauseFrame = floor(uniforms.phase * 8.0);
        float pauseRow = floor(sampleUv.y * uniforms.resolution.y / 4.0);
        float rowOffset = frameNoise(vec2(pauseRow, pauseFrame)) - 0.5;
        float trackingBand = 1.0 - smoothstep(
            0.008, 0.026, abs(sampleUv.y - 0.855));
        sampleUv.x += rowOffset
            * (0.00045 + 0.0032 * trackingBand) * paused;
    }

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

    if (paused > 0.001) {
        float pauseFrame = floor(uniforms.phase * 8.0);
        float pauseRow = floor(sampleUv.y * uniforms.resolution.y / 3.0);
        float pauseNoise = frameNoise(vec2(pauseRow, pauseFrame));
        float trackingBand = 1.0 - smoothstep(
            0.008, 0.026, abs(sampleUv.y - 0.855));

        // VHS colour resolution was much softer than luminance. A restrained
        // red/blue delay reads as tape smear while the frozen picture remains
        // firmly in place.
        float pauseChromaOffset = (1.8 + 2.2 * trackingBand) * pixel.x;
        vec3 pauseColour = vec3(
            texture(source,
                    clamp(sampleUv + vec2(pauseChromaOffset, 0.0),
                          sampleMinimum,
                          sampleMaximum)).r,
            centreSample.g,
            texture(source,
                    clamp(sampleUv - vec2(pauseChromaOffset, 0.0),
                          sampleMinimum,
                          sampleMaximum)).b);
        colour = mix(colour, pauseColour, 0.42 * paused);

        float fineLine = pow(0.5 + 0.5 * sin(
            sampleUv.y * uniforms.resolution.y * 1.45
            + pauseNoise * 5.0), 18.0);
        float dropout = trackingBand * smoothstep(0.68, 0.96, pauseNoise);
        colour += (pauseNoise - 0.5) * 0.052 * paused;
        colour += vec3(0.075, 0.065, 0.085) * fineLine * paused;
        colour += vec3(0.12) * dropout * paused;
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
