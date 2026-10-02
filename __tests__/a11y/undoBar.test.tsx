import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { UndoBar } from '@/features/today/components/UndoBar';

const undo = { message: 'Metformin marked taken', run: jest.fn() };

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('UndoBar', () => {
  it('goes away by itself after a few seconds', async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const onDismiss = jest.fn();
    await render(<UndoBar undo={undo} onDismiss={onDismiss} />);
    expect(screen.getByText('Metformin marked taken')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(8100);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays until dismissed for screen-reader users, who need longer to find it', async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const onDismiss = jest.fn();
    await render(<UndoBar undo={undo} onDismiss={onDismiss} />);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
