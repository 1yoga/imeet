# iMeet

Мобильный каркас приложения знакомств iMeet с главным экраном голосового AI-агента в mock-режиме.

Стек первого этапа:

- React Native 0.88.1
- Expo SDK 58
- TypeScript
- Expo Router
- Zustand

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

На этом этапе реальный ASR, Silero VAD, TTS и серверный AI-агент не подключены. Их границы описаны TypeScript-контрактами в `src/core/voice` и `src/core/agent`.

## AI Conversation

Главный экран собран из локальных ассетов Figma в `assets/figma` и компонентов в `src/components/ai-conversation`.

- Кнопка «Не могу слушать» проигрывает mock-переходы `preparing → listening → recognizing → thinking → speaking → idle`.
- Кнопка «Не могу говорить» проигрывает mock-переход `preparing → speaking → idle`.
- Долгое нажатие на вторую кнопку проверяет состояние `error`.
- Информационную подсказку можно закрыть, а вкладки нижней навигации переключаются локально.
