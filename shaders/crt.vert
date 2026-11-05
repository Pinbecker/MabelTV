#version 440
layout(location = 0) in vec4 qt_Vertex;
layout(location = 1) in vec2 qt_MultiTexCoord0;
layout(location = 0) out vec2 qt_TexCoord0;
layout(location = 1) out vec2 glassUv;
layout(location = 2) out vec3 glassSurface;
layout(location = 3) out vec2 noiseUv;
layout(location = 4) out vec4 colourMix;
layout(location = 5) out vec3 gainValues;
layout(location = 6) out float glassMask;
layout(std140, binding = 0) uniform Buffer {
    mat4 qt_Matrix;
    float qt_Opacity;
    float flicker;
    float effectStrength;
    float glassCurve;
    float maskExponent;
    float distortion;
    float pausedEffect;
    float phase;
    float cornerRadius;
    float maskSoftness;
    vec2 resolution;
} uniforms;


void main() {
    qt_TexCoord0 = qt_MultiTexCoord0;
    gl_Position = uniforms.qt_Matrix * qt_Vertex;
    vec2 centered = qt_TexCoord0 * 2.0 - 1.0;
    vec2 point = abs(centered), safePoint = max(point, vec2(0.0001));
    float exponent = uniforms.maskExponent;
    vec2 powers = pow(safePoint, vec2(exponent));
    vec2 resolution = max(uniforms.resolution, vec2(1.0));
    vec2 gradient = exponent * powers / safePoint * 2.0;
    float softness = max(uniforms.maskSoftness * 2.2 / min(resolution.x,resolution.y), dot(gradient,1.0/resolution)*1.5);
    float vignette = 1.0 - 0.18 * uniforms.glassCurve * smoothstep(0.38,1.25,length(centered));
    float depth = 1.0 - 0.13 * uniforms.glassCurve * pow(abs(centered.x*centered.y),1.35);
    glassSurface = vec3(powers.x+powers.y,softness,vignette*depth);
    float amount = 0.044 * uniforms.glassCurve;
    glassUv = centered * (1.0+amount*dot(centered,centered)) / (1.0+amount*2.0) * 0.5+0.5;
    // Uniform colour/noise coefficients and scanline phase do not need to be
    // recalculated for every picture pixel. Even row shifts retain line phase.
    float d = clamp(uniforms.distortion, 0.0, 1.0);
    float gain = 1.0 - 0.018*d, grey = 0.075*d;
    colourMix = vec4((1.0-grey)*gain, grey*gain, .105*d*gain, .035*d*d*gain);
    gainValues = vec3(.00825*d-.5*(colourMix.z+colourMix.w),
        .018*uniforms.effectStrength+.055*d,
        1.0-uniforms.flicker*(.001*uniforms.effectStrength+.003*d));
    noiseUv = (glassUv*uniforms.resolution
        + vec2(floor(uniforms.phase*31.0),2.0*floor(uniforms.phase*8.5)))/256.0;
    glassMask = (1.0-glassSurface.x)/(2.0*glassSurface.y)+.5;
}
