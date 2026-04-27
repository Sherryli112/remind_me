"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisplaySettingsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let DisplaySettingsService = class DisplaySettingsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getCurrent() {
        let setting = await this.prisma.displaySetting.findFirst({
            include: { mascotImages: true },
        });
        if (!setting) {
            setting = await this.prisma.displaySetting.create({
                data: {},
                include: { mascotImages: true },
            });
        }
        return setting;
    }
    async updateCurrent(dto) {
        const current = await this.getCurrent();
        return this.prisma.displaySetting.update({
            where: { id: current.id },
            data: {
                ...dto,
                targetScreenId: dto.targetScreenId !== undefined ? dto.targetScreenId || null : current.targetScreenId,
            },
            include: { mascotImages: true },
        });
    }
};
exports.DisplaySettingsService = DisplaySettingsService;
exports.DisplaySettingsService = DisplaySettingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DisplaySettingsService);
//# sourceMappingURL=display-settings.service.js.map