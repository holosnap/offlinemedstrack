import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from './AppText';
import { fontSize, minTouchTarget, radius, spacing, usePalette } from './theme';

interface TextFieldProps extends Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'keyboardType'
  | 'multiline'
  | 'placeholder'
  | 'autoCapitalize'
  | 'maxLength'
> {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  testID?: string;
}

/** A labelled text input; the label stays visible (not just a placeholder) and errors are announced. */
export function TextField({
  label,
  required,
  hint,
  error,
  multiline,
  testID,
  ...input
}: TextFieldProps) {
  const palette = usePalette();
  const spoken = [required ? 'required' : null, error ? `error: ${error}` : hint]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.container}>
      <AppText variant="label" accessible={false} importantForAccessibility="no">
        {label}
        {required ? ' *' : ''}
      </AppText>
      {hint ? (
        <AppText variant="caption" muted accessible={false} importantForAccessibility="no">
          {hint}
        </AppText>
      ) : null}
      <TextInput
        {...input}
        multiline={multiline}
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={spoken || undefined}
        placeholderTextColor={palette.textMuted}
        style={[
          styles.input,
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: error ? palette.danger : palette.border,
            borderWidth: error ? 3 : 2,
          },
          multiline && styles.multiline,
        ]}
      />
      {error ? (
        <AppText variant="caption" color={palette.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  input: {
    minHeight: minTouchTarget,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
  },
  multiline: { minHeight: minTouchTarget * 2, textAlignVertical: 'top' },
});
