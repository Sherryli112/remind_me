import { MascotMode, PopupCorner, PopupSize, PopupTheme } from '../../common/enums';
export declare class UpdateDisplaySettingDto {
    size?: PopupSize;
    theme?: PopupTheme;
    corner?: PopupCorner;
    showContent?: boolean;
    targetScreenId?: string;
    mascotMode?: MascotMode;
}
