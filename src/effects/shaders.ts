/**
 * 외부 텍스처를 쓰지 않는다.
 *
 * 이유는 미술이 아니라 소유권이다. 이 모듈의 규칙은 "모듈이 만든 GPU 자원은 모듈이 회수한다"인데,
 * 텍스처를 파일에서 로드하는 순간 (a) 비동기 로딩 실패 경로, (b) 로더/캐시 소유권,
 * (c) 두 씬이 같은 텍스처를 공유할 때 누가 dispose 하는가 라는 문제가 한꺼번에 딸려온다.
 * gl_PointCoord 기반 절차적 스프라이트는 그 세 개를 전부 없애고,
 * 덤으로 해상도 독립적이며 npm 패키지에 바이너리가 안 들어간다.
 *
 * 대가: 원형 그라디언트 말고 다른 모양(불규칙한 파편, 연기 노이즈)은 못 만든다.
 * 필요해지면 그때 절차적 노이즈를 프래그먼트에 넣는 쪽이, 텍스처를 도입하는 쪽보다 싸다.
 */

/**
 * 정점: 죽은 슬롯은 클립 공간 밖으로 밀어 즉시 폐기한다.
 * 링 버퍼는 draw 구간 안에 죽은 슬롯이 섞일 수 있으므로 이 조기 폐기가 필수다.
 * gl_PointSize를 화면 픽셀로 환산할 때 projectionMatrix[1][1] = 1/tan(fov/2) 를 쓴다.
 * 덕분에 모듈이 카메라 fov를 따로 받을 필요가 없다 — 씬과의 접점이 하나 줄어든다.
 */
export const IMPACT_BURST_VERTEX = /* glsl */ `
  attribute float aLife;
  attribute float aSeed;

  uniform float uSizeStart;
  uniform float uSizeEnd;
  uniform float uViewportHeight;
  uniform float uSizeSeedMin;
  uniform float uSizeSeedRange;
  uniform float uMinPointSize;

  varying float vLife;

  void main() {
    vLife = aLife;

    if ( aLife <= 0.0 ) {
      gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
      gl_PointSize = 0.0;
      return;
    }

    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    float age = 1.0 - aLife;
    float worldSize = mix( uSizeStart, uSizeEnd, age )
      * ( uSizeSeedMin + uSizeSeedRange * aSeed );

    float depth = max( 1e-4, -mvPosition.z );
    float pixels = worldSize * uViewportHeight * projectionMatrix[1][1] * 0.5 / depth;

    gl_PointSize = max( uMinPointSize, pixels );
    gl_Position = projectionMatrix * mvPosition;
  }
`

/**
 * 프래그먼트: 반경 기반 소프트 디스크.
 * 톤매핑/색공간 청크를 직접 include 한다 — ShaderMaterial은 three가 자동으로 붙여주지 않으므로,
 * 빼먹으면 씬 B(ACESFilmic + sRGB 출력)에서 파티클만 색이 튄다.
 */
export const IMPACT_BURST_FRAGMENT = /* glsl */ `
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform float uOpacity;
  uniform float uFadeOutRatio;

  varying float vLife;

  void main() {
    vec2 offset = gl_PointCoord - 0.5;
    float radius = length( offset ) * 2.0;
    if ( radius > 1.0 ) discard;

    float core = 1.0 - smoothstep( 0.0, 1.0, radius );
    vec3 color = mix( uColorEdge, uColorCore, core * core );
    float alpha = core * uOpacity * smoothstep( 0.0, uFadeOutRatio, vLife );

    gl_FragColor = vec4( color, alpha );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
