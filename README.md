# iMeet

Мобильный каркас приложения знакомств iMeet с голосовым вводом на Android.

Стек первого этапа:

- React Native 0.88.1
- Expo SDK 58
- TypeScript
- Expo Router
- Zustand
- EAS Development Build (`expo-dev-client`)

## Запуск

```bash
npm install
npm run start
```

Затем выберите iOS или Android в Expo CLI. Для прямого запуска:

```bash
npm run ios
npm run android
```

## Проверки

```bash
npm run typecheck
npm run doctor
```

## Android Development Build

Локальный Android SDK в рабочей директории не требуется: development APK собирается
через EAS Build. Профиль `development` находится в `eas.json` и выдаёт
устанавливаемый APK, а не AAB.

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile development
```

После завершения EAS покажет ссылку на APK. Установка на физический Android:

```bash
npx eas-cli@latest build:run --platform android --profile development
```

или откройте ссылку на APK на устройстве и установите файл вручную. Для запуска
JS-бандла development client используйте:

```bash
npx expo start --dev-client
```

Авторизация Expo/EAS обязательна для облачной сборки; платная инфраструктура для
этого профиля не добавляется.

## Native layout and fonts

Экран использует `useSafeAreaInsets` и `useWindowDimensions`: размеры Figma 412×852
являются базовыми токенами, но не фиксированным размером приложения. Нижний Tab Bar
учитывает системный нижний inset, а статус-бар получает светлый режим.

`expo-glass-effect` используется только когда Liquid Glass доступен на iOS 26+.
На Android и старых iOS используется прозрачный градиентный fallback с верхней
подсветкой и границей — без WebView и без непрозрачной заглушки.

Figma использует Gilroy, Manrope и SF Pro. Лицензированные бинарные файлы в проекте
отсутствуют, поэтому временный fallback — системный SF Pro на iOS и Roboto на Android.
Интеграционная точка `src/theme/fonts.ts` подготовлена через `expo-font`. Для точного
рендера нужно предоставить:

- `Gilroy-Medium.ttf`
- `Manrope-Medium.ttf`
- `Manrope-SemiBold.ttf`
- `SFProText-Semibold.ttf`

## AI Conversation

Главный экран собран из локальных ассетов Figma в `assets/figma` и компонентов в `src/components/ai-conversation`.

Для голосового ввода нужен Android Development Build с `@naslukh/speech-rn@0.1.0`.

1. Установите свежий APK, запустите `npx expo start --dev-client` и откройте iMeet на телефоне.
2. При открытии главного экрана iMeet проверяет локальную модель. Если её ещё нет, приложение скачивает архив (~163 МиБ), проверяет SHA-256 и распаковывает файлы. Naslukh 0.1.0 не предоставляет отмену загрузки.
3. После сообщения «Модель речи готова» нажмите «Начать общение» и разрешите доступ к микрофону. Произнесите фразу по-русски. После трёх секунд тишины или по кнопке «Закончить фразу» iMeet покажет распознанный текст и выберет ответ из локального сценария.
4. После окончания ответа iMeet автоматически включит микрофон. «Завершить разговор» прекращает прослушивание или озвучку. Последняя распознанная фраза и ответ остаются на экране.
5. Установленный APK без `ExpoSpeech` позволяет проверять этот цикл через Metro с текстовыми ответами. Для озвучки нужен новый Android APK с `expo-speech` и русский голос системного движка Android. [Expo Speech](https://docs.expo.dev/versions/v58.0.0/sdk/speech/)

Анимация волны во время речи включается по событию VAD из Naslukh. Для реакции на громкость Naslukh нужен отдельный поток событий, например `onAudioLevel({ rmsDbFS })`, рассчитанный по уже захваченным PCM-кадрам и ограниченный примерно 10–20 обновлениями в секунду.

Для короткого подтверждения после 1 секунды тишины Naslukh нужен сигнал посреди той же реплики. Минимальный вариант — опция `backchannelSilenceMs: 1000` и событие `onVadPause({ sessionId, silenceMs })`, которое нативный модуль отправляет после приостановки захвата, сохраняя буфер реплики. Приложение произносит «Угу» и вызывает `resumeListenOnce(sessionId)` после окончания озвучки. Захват продолжится в рамках той же реплики до порога `vadMinSilenceSec: 3`. Тишину нужно измерять по захваченным кадрам, сбрасывая счётчик при возобновлении речи. Во время подтверждения микрофон приостановлен, поэтому слова пользователя в этот момент могут быть пропущены. В версии 0.1.0 работает только окончание реплики по трём секундам.

## Supertonic 3 INT8 на Android

В Android-сборке с локальным модулем `IMeetSupertonic` перед началом разговора можно выбрать «Supertonic 3 · F1» или «Системный TTS». Supertonic при первом запуске разговора скачивает около 139 МиБ. Модель закреплена на ревизии `cca5a0e6`. Приложение проверяет размер и SHA-256 каждого файла и сохраняет его в приватном кэше. Последующие разговоры используют проверенные локальные файлы. JNI и ONNX Runtime берутся из того же Maven-артефакта sherpa-onnx 1.13.5, что и для Naslukh. [Файлы модели](https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/tree/cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4)

Чтобы проверить на OnePlus, установите Android-сборку с новым модулем, выберите F1 и начните разговор. Проверьте первую загрузку, повторное использование кэша без сети, произношение и прерывание через «Завершить разговор». При остановке во время синтеза уже начатый вызов ONNX завершается, а его результат отбрасывается. Во время воспроизведения остановка приостанавливает AudioTrack и освобождает его. Смена движка доступна между разговорами.

Метрики в `adb logcat -s IMeetSupertonic:I`. `initMs` измеряется отдельно от загрузки и проверки файлов, `synthesisMs` — время синтеза, `firstFrameMs` — время от запроса до первого обнаруженного кадра в Android AudioTrack. PSS суммарный для текущего процесса, `initPssDeltaKb` и `playbackPssDeltaKb` считаются относительно замера перед созданием модели.

Первичный замер на OnePlus 7 Pro выполнен тем же Kotlin-движком в отдельном Android-процессе без ASR. Для трёх прогонов фразы «Привет! Как ты любишь проводить свободное время?» получились 1,03 с на инициализацию, 2,74 с медианного синтеза и 2,79 с до первого кадра. Дополнительный PSS составил около 178 МиБ после инициализации и 242–262 МиБ при воспроизведении. Повторите замер в самом iMeet после первой реплики, когда ASR уже загружен.

## Размер Android APK

Development APK `ad6b6684` весит 399,2 МБ (380,7 МиБ). В ZIP на нативные библиотеки приходится 372,0 МБ (93,2%) — 106,2 МБ для `x86`, 104,0 МБ для `x86_64`, 99,2 МБ для `arm64-v8a` и 62,6 МБ для `armeabi-v7a`. Библиотеки ONNX Runtime и sherpa-onnx занимают 125,5 МБ по всем ABI. DEX занимает 21,8 МБ, а модели скачиваются отдельным архивом.

1. После проверки текущей сборки подготовить release-профиль EAS с `developmentClient: false` и `android.buildType: "apk"` для установки на OnePlus. Для этого профиля ограничить `expo-build-properties.android.buildArchs` до `["arm64-v8a"]`. Удаление трёх лишних ABI экономит около 273 МБ по составу текущего APK. Оставшиеся ~126 МБ — оценка по debug-артефакту до сборки release. [Expo BuildProperties](https://docs.expo.dev/versions/latest/sdk/build-properties/)
2. На release-профиле измерить отдельный вклад R8 и удаления неиспользуемых ресурсов. Проверить JNI и распознавание Naslukh с правилами consumer ProGuard, которые поставляет библиотека. Сравнить размер артефактов и повторить тест офлайн на устройстве. [Android App Optimization](https://developer.android.com/topic/performance/app-optimization/customize-which-resources-to-keep)
3. Для Google Play выпускать AAB с нужными ABI. Google Play формирует APK с нативными библиотеками для ABI конкретного устройства. [Android App Bundles](https://developer.android.com/build/configure-apk-splits)
