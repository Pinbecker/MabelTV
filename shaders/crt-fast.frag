#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 1) in vec2 glassUv;
layout(location = 2) in vec3 glassSurface;
layout(location = 3) in vec2 noiseUv;
layout(location = 4) in vec4 colourMix;
layout(location = 5) in vec3 gainValues;
layout(location = 6) in float glassMask;
layout(location = 0) out vec4 fragColor;
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

layout(binding = 1) uniform sampler2D source;
layout(binding = 2) uniform sampler2D grainTexture;
layout(binding = 3) uniform sampler2D foreground;
vec4 pictureAt(vec2 uv)
{
    vec4 picture = texture(source, uv);
    picture.rgb += vec3(1.0, 2.0, 1.0) / 255.0 * (1.0-picture.a);
    picture.a = 1.0;
    vec4 overlay = texture(foreground, uv);
    return overlay + picture * (1.0-overlay.a);
}

void main() {
    float mask=clamp(glassMask,0.0,1.0);
    mask=mask*mask*(3.0-2.0*mask);
    if(mask<=0.0){fragColor=vec4(0.0);return;}
    vec4 picture=pictureAt(glassUv);
    vec3 grain=texture(grainTexture,noiseUv).rgb;
    float grey=dot(picture.rgb,vec3(.299,.587,.114))*colourMix.y
        + dot(grain.rb,colourMix.zw)+gainValues.x;
    vec3 colour=(picture.rgb*colourMix.x+vec3(grey))
        *(1.0-gainValues.y*grain.g)*glassSurface.z*gainValues.z;
    float alpha=picture.a*mask*uniforms.qt_Opacity;
    fragColor=vec4(colour*alpha,alpha);
}
