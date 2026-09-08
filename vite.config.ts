import { defineConfig } from 'vite'

/**
 * 의도적으로 플러그인 0개.
 * 평가자는 `npm install` 1회 + `npm run dev` 1회만 실행한다.
 * 빌드 파이프라인에 변수를 추가할수록 "구동 실패" 위험만 커지고 과제 본질과는 무관하다.
 */
export default defineConfig({
  /**
   * 상대 경로로 에셋을 참조한다.
   *
   * GitHub Pages는 `https://<user>.github.io/<repo>/` 처럼 하위 경로에서 서빙하므로,
   * 기본값 '/' 로 두면 빌드 결과가 `/assets/...` 를 찾다가 전부 404가 난다.
   *
   * 저장소 이름을 박아 `base: '/EffectModuleDemo/'` 로 두는 방법도 있지만,
   * 그러면 저장소 이름을 바꾸는 순간 데모가 조용히 깨지고 로컬 `npm run dev` 주소도
   * 하위 경로로 밀린다. './' 는 루트든 하위 경로든 어디에 올려도 그대로 동작한다.
   * 클라이언트 라우팅이 없는 단일 페이지라 상대 경로로 잃는 것이 없다.
   */
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
