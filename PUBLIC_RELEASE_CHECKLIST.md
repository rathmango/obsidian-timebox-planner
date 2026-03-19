# Public Release Checklist

이 폴더는 그대로 공개용 GitHub repo 루트로 써도 됩니다.

## 추천 공개 방식

1차 공개는 `public GitHub repo + Release zip` 조합을 권장합니다.

- 장점: 링크 공유가 쉽고, 버전 관리가 되며, 댓글/DM 요청에 바로 응답할 수 있습니다.
- 현재 단계에서는 Obsidian 커뮤니티 플러그인 등록보다 이 방식이 훨씬 가볍습니다.

## 권장 repo 이름

- `obsidian-timebox-planner`
- `obsidian-daily-timebox-planner`

플러그인 ID는 현재 `timebox-planner`를 유지하는 편이 안전합니다.

## repo 루트에 둘 파일

- `manifest.json`
- `main.js`
- `styles.css`
- `README.md`
- `.gitignore`
- `PUBLIC_RELEASE_CHECKLIST.md`

선택:

- `assets/` 스크린샷 또는 GIF
- `LICENSE`
- `CHANGELOG.md`

## 공개 전 확인

- README 첫 화면에서 플러그인의 문제 정의가 바로 읽히는지 확인
- 수동 설치 방법이 1분 안에 따라 할 수 있게 적혀 있는지 확인
- 개인 vault 경로, 내부 노트명, 사적인 스크린샷이 섞여 있지 않은지 확인
- `manifest.json` 버전과 Release 태그가 일치하는지 확인
- 공개 범위에 맞는 라이선스를 명시적으로 선택

라이선스는 자동으로 정하지 말고, 아래 둘 중 하나를 먼저 결정하는 걸 권장합니다.

- 오픈소스로 넓게 공유할 생각이면 `MIT`
- 아직 공개 베타 수준으로만 배포할 생각이면 라이선스 없이 사전 공유 범위를 먼저 정리

## 첫 Git / GitHub 공개 절차

```bash
git init -b main
git add manifest.json main.js styles.css README.md .gitignore PUBLIC_RELEASE_CHECKLIST.md
git commit -m "Prepare public beta release"
gh repo create obsidian-timebox-planner --public --source=. --remote=origin --push
```

## 첫 Release zip 만들기

Obsidian 수동 설치에는 보통 아래 3개 파일만 있으면 됩니다.

- `manifest.json`
- `main.js`
- `styles.css`

예시:

```bash
mkdir -p release
zip -j "release/timebox-planner-0.0.1.zip" manifest.json main.js styles.css README.md
gh release create v0.0.1 "release/timebox-planner-0.0.1.zip" --title "Timebox Planner v0.0.1"
```

## 링크드인에서 어떻게 말할지

포인트는 “일정 관리 앱 하나 더 만들었다”가 아니라, 아래처럼 워크플로우를 선명하게 설명하는 것입니다.

- Obsidian Daily 안에서 `Brain Dump -> Top Priorities -> Timebox`를 한 흐름으로 붙인 플러그인
- AI 때문에 빨라진 실행 속도와 더 어려워진 우선순위 관리를 해결하려고 만든 도구
- 개인용으로 시작했지만 작은 팀의 하루 맥락 공유에도 도움이 되는 도구

## 다음 단계

1. 공개용 스크린샷 또는 GIF 1개 추가
2. GitHub public repo 생성
3. `v0.0.1` Release zip 업로드
4. 링크드인 포스트 발행 또는 댓글/DM 응답 링크로 활용
