import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { minTouchTarget, radius, spacing, usePalette } from './theme';

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  /** Spoken label when the visible text is abbreviated (e.g. "Mon" → "Monday"). */
  accessibilityLabel?: string;
}

interface BaseProps<T extends string | number> {
  label: string;
  choices: readonly Choice<T>[];
  error?: string;
  testID?: string;
}

interface SingleProps<T extends string | number> extends BaseProps<T> {
  multiple?: false;
  selected: T;
  onChange: (value: T) => void;
}

interface MultiProps<T extends string | number> extends BaseProps<T> {
  multiple: true;
  selected: readonly T[];
  onChange: (value: T[]) => void;
}

/**
 * Pick one (radio buttons) or several (checkboxes) from a short list. Selection is shown with a
 * check mark and a heavier border as well as color, so it never relies on color alone.
 */
export function ChoiceGroup<T extends string | number>(props: SingleProps<T> | MultiProps<T>) {
  const palette = usePalette();
  const isSelected = (value: T) =>
    props.multiple ? props.selected.includes(value) : props.selected === value;

  const toggle = (value: T) => {
    if (props.multiple) {
      const next = props.selected.includes(value)
        ? props.selected.filter((v) => v !== value)
        : [...props.selected, value];
      props.onChange(next);
    } else {
      props.onChange(value);
    }
  };

  return (
    <View style={styles.container} testID={props.testID}>
      <AppText variant="label" accessibilityRole="text">
        {props.label}
      </AppText>
      <View
        accessibilityRole={props.multiple ? undefined : 'radiogroup'}
        accessibilityLabel={props.label}
        style={styles.row}
      >
        {props.choices.map((choice) => {
          const selected = isSelected(choice.value);
          return (
            <Pressable
              key={choice.value}
              accessibilityRole={props.multiple ? 'checkbox' : 'radio'}
              accessibilityLabel={choice.accessibilityLabel ?? choice.label}
              accessibilityState={props.multiple ? { checked: selected } : { selected }}
              onPress={() => toggle(choice.value)}
              style={[
                styles.choice,
                {
                  backgroundColor: selected ? palette.primary : palette.surface,
                  borderColor: selected ? palette.primary : palette.border,
                  borderWidth: selected ? 3 : 2,
                },
              ]}
            >
              <AppText variant="body" color={selected ? palette.onPrimary : palette.text}>
                {selected ? '✓ ' : ''}
                {choice.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {props.error ? (
        <AppText variant="caption" color={palette.danger} accessibilityLiveRegion="polite">
          {props.error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
