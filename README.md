# iMeet

Прототип приложения знакомств с голосовым AI-агентом на русском. Сейчас — Android без бэкенда:
ответы агента и данные кандидатов тестовые. Дальше — бэкенд, затем iOS.

Стек: React Native 0.88.1, Expo SDK 58, TypeScript, Expo Router, Zustand.

## Экраны

| Экран | Где в коде | Макет Figma |
|---|---|---|
| Главный: голосовой разговор с агентом, отсчёт 3-2-1, текстовый режим «Не могу говорить» | `src/components/ai-conversation` | 48:223, 48:461, 39:126 |
| Карточка симпатии (вкладка «Карточки симпатий») | `src/components/matches/MatchCard.tsx` | 56:290 |
| Профиль кандидата: анкета и вопросы агенту о человеке голосом или текстом | `src/components/candidate/CandidateProfileScreen.tsx` | 73:521, 141:2487, 141:2637 |
| Просмотр фото | `src/components/candidate/PhotoViewerScreen.tsx` | 104:762 |
| Чат с кандидатом | `src/components/chat` | компонент Message 141:1992 |
| Вкладка «Профиль»: меню и диалоги (имя, город, уведомления, выход) | `src/components/profile` | 107:3160 и диалоги |
| Голос и паузы (пункт меню профиля), Voice Lab | `src/components/profile/ProfileVoiceSettings.tsx`, `src/components/voice-lab` | — |

Маршруты: `/` (вкладки), `/candidate/[id]`, `/photos/[id]`, `/chat/[id]`, `/voice-lab`.

Тестовые данные: кандидат Валерия (`src/features/matches/candidates.ts`, фото в `assets/candidates`),
ответы агента о ней по ключевым словам (`candidateQa.ts`), общий разговор (`mockConversationService.ts`).
Чат хранится в памяти до перезапуска, доставка сообщений имитируется. Имя, город, аватар
и настройки уведомлений сохраняются в AsyncStorage (`src/core/settings/userProfile.ts`).

## Голос

- **Распознавание** — библиотека [`@naslukh/speech-rn`](https://www.npmjs.com/package/@naslukh/speech-rn) 0.2.0
  (GigaAM v3 + Silero VAD, офлайн). Модель (~163 МиБ) скачивается при первом запуске.
  Из 0.2.0 используются: уровень громкости для волны, пауза внутри реплики для коротких реакций агента
  («Понятно», «Ага»), эхоподавление и монитор речи для перебивания агента.
- **Озвучка** — Silero `v5_5_ru` через внешний движок [RuVoice TTS](https://github.com/kost-t-human/ruvoice-tts)
  (голоса xenia, kseniya, baya, aidar, eugene; пак `cis_ru` — ru_saida, ru_zinaida, ru_eduard).
  Если RuVoice не установлен — системный TTS Android. Мост к движку — нативный модуль `modules/imeet-voice`.
- **Интонации.** Ответы размечены логическим ударением: ключевое слово в звёздочках (`*куда*`);
  RuVoice его понимает (правило «Логическое ударение»), на экране звёздочки снимаются (`focusMarks.ts`).
- **Настройки** («Профиль» → «Голос и паузы»): голос, пауза конца фразы (до 3 с), пауза перед ответом,
  пауза до короткой реплики, перебивание агента голосом.
- Модели Silero распространяются под некоммерческой лицензией; для продукта нужна коммерческая лицензия Silero.

## Волна

GPU-шейдер на Skia (`src/components/ai-conversation/wave/waveShader.ts`), анимация в UI-потоке через Reanimated.
Реагирует на громкость микрофона и состояние разговора. Математика проверяется прототипом
`tools/wave-proto.py` (numpy, рендерит кадры). Если шейдер не скомпилировался, показывается картинка из Figma.
Размытие под диалогами и отсчётом — `expo-blur` (`BlurTargetView`, Android 12+).

## Сборка и установка на телефон

Скрипты для Windows в `tools/`:

- `ship.cmd` — уборка, недостающие нативные пакеты, проверка типов (`artifacts/typecheck-log.txt`),
  release APK, установка на телефон по USB (`adb`), коммит. Повторный запуск пропускает сделанное.
- `build-android.cmd` — только сборка и установка (`artifacts/imeet-silero55.apk`, лог `artifacts/build-log.txt`).
- `cleanup.cmd` — убрать старые APK, скриншоты и устаревшие файлы в Корзину Windows.
- `measure-voice.cmd` — замер задержки озвучки и памяти через Voice Lab по `adb`.

APK собирается под один ABI `arm64-v8a` с R8 и удалением неиспользуемых ресурсов, без Metro;
модель распознавания в APK не входит. На Windows `app.config.js` задаёт CMake 3.31.6 (длинные пути).
Локальный APK подписан тестовым ключом и обновляет пакет `com.imeet.voicecheck`.

Вручную:

```powershell
npx expo prebuild --platform android --no-install
cd android
.\gradlew.bat :app:assembleRelease
```

Проверка типов: `npm run typecheck`.

## Шрифты

В макете Gilroy, Manrope и SF Pro; лицензионных файлов в проекте нет, поэтому пока системные шрифты
(`src/theme/fonts.ts`). Для точного рендера нужны `Gilroy-Medium.ttf`, `Manrope-Medium.ttf`,
`Manrope-SemiBold.ttf`, `SFProText-Semibold.ttf`.
