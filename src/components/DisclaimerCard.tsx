import { AppText } from './AppText';
import { Card } from './Card';
import { DISCLAIMER_TEXT, DISCLAIMER_TITLE } from '@/lib/disclaimer';

/** The "reminder tool, not medical advice" notice shown in onboarding and Settings. */
export function DisclaimerCard() {
  return (
    <Card title={DISCLAIMER_TITLE} testID="disclaimer">
      <AppText>{DISCLAIMER_TEXT}</AppText>
    </Card>
  );
}
