/**
 * Which way a tab switch animates. Tabs swap screens with router.replace,
 * which native-stack animates as a push (in from the right) by default. The
 * tab bar records the direction just before replacing, and the tab layouts'
 * screenOptions read it as animationTypeForReplace: a tab to the right slides
 * in from the right ("push"), a tab to the left from the left ("pop").
 */
export type ReplaceAnimation = 'push' | 'pop';

let next: ReplaceAnimation = 'push';

export function tabDirection(from: number, to: number): ReplaceAnimation {
  return from >= 0 && to < from ? 'pop' : 'push';
}

export function setTabReplaceAnimation(animation: ReplaceAnimation): void {
  next = animation;
}

export function tabReplaceAnimation(): ReplaceAnimation {
  return next;
}
