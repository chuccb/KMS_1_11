/** Native 1:1 miniroom constants shared without importing browser UI state. */

/** `sub_4D2DB0` allocates eight 16-byte cells per side; `sub_4D63C0` numbers them 1..8. */
export const TRADE_SLOTS = 8;

/** `CTradingRoomDlg` has one participant per trade side. */
export const TRADE_PARTICIPANT_CAPACITY = 2;

/** `sub_481570` builds only room kind 1 as the 1:1 trade dialog. */
export const MINIROOM_TRADE_KIND = 1;

/** MiniRoom type 2 code 2 includes the busy character's name (`sub_481B20`). */
export const MINIROOM_BUSY_REFUSAL_CODE = 2;
