import type { ControlState } from '../objects/clonk';

/** Items per row in an object menu (C4Menu::InitMenu: Columns = 5 for normal menus). */
export const MENU_COLUMNS = 5;

/**
 * Move the selection of an object menu like C4Menu::Control: left and right go
 * one item and wrap round the ends, up and down go a row and wrap to the other
 * end of the column.
 */
export function menuMove(sel: number, count: number, ctl: ControlState, columns = MENU_COLUMNS): number {
  if (count <= 0) return 0;
  let i = Math.max(0, Math.min(sel, count - 1));
  if (ctl.pressedLeft) i = i - 1 < 0 ? count - 1 : i - 1;
  if (ctl.pressedRight) i = i + 1 >= count ? 0 : i + 1;
  if (ctl.pressedUp) {
    let d = -columns;
    if (i + d < 0) while (i + d + columns < count) d += columns;
    i += d;
  }
  if (ctl.pressedDown) {
    let d = columns;
    if (i + d >= count) while (i + d - columns >= 0) d -= columns;
    i += d;
  }
  return i;
}
