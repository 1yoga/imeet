import { BlurView } from 'expo-blur';
import { createContext, type RefObject, useContext } from 'react';
import { StyleSheet, View } from 'react-native';

/** Ссылка на BlurTargetView экрана: всё, что внутри, размывается под диалогами и отсчётом. */
export const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

/**
 * Размытый фон на весь экран (expo-blur). На Android размывает содержимое BlurTargetView
 * через RenderNode (Android 12+); на старых версиях остаётся только затемнение.
 */
export function BlurBackdrop({ intensity = 70, dim = 'rgba(6, 4, 24, 0.35)' }: { intensity?: number; dim?: string }) {
  const target = useContext(BlurTargetContext);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <BlurView
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={target ?? undefined}
        intensity={intensity}
        style={StyleSheet.absoluteFill}
        tint="dark"
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: dim }]} />
    </View>
  );
}
