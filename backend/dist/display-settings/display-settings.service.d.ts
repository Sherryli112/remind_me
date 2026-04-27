import { PrismaService } from '../prisma/prisma.service';
import { UpdateDisplaySettingDto } from './dto/update-display-setting.dto';
export declare class DisplaySettingsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getCurrent(): Promise<{
        mascotImages: {
            id: string;
            filePath: string;
            mimeType: string;
            width: number;
            height: number;
            sizeBytes: number;
            displaySettingId: string;
        }[];
    } & {
        size: import("@prisma/client").$Enums.PopupSize;
        theme: import("@prisma/client").$Enums.PopupTheme;
        corner: import("@prisma/client").$Enums.PopupCorner;
        showContent: boolean;
        targetScreenId: string | null;
        mascotMode: import("@prisma/client").$Enums.MascotMode;
        id: string;
    }>;
    updateCurrent(dto: UpdateDisplaySettingDto): Promise<{
        mascotImages: {
            id: string;
            filePath: string;
            mimeType: string;
            width: number;
            height: number;
            sizeBytes: number;
            displaySettingId: string;
        }[];
    } & {
        size: import("@prisma/client").$Enums.PopupSize;
        theme: import("@prisma/client").$Enums.PopupTheme;
        corner: import("@prisma/client").$Enums.PopupCorner;
        showContent: boolean;
        targetScreenId: string | null;
        mascotMode: import("@prisma/client").$Enums.MascotMode;
        id: string;
    }>;
}
