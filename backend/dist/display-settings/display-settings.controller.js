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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisplaySettingsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const update_display_setting_dto_1 = require("./dto/update-display-setting.dto");
const display_settings_service_1 = require("./display-settings.service");
let DisplaySettingsController = class DisplaySettingsController {
    displaySettingsService;
    constructor(displaySettingsService) {
        this.displaySettingsService = displaySettingsService;
    }
    getCurrent() {
        return this.displaySettingsService.getCurrent();
    }
    updateCurrent(dto) {
        return this.displaySettingsService.updateCurrent(dto);
    }
};
exports.DisplaySettingsController = DisplaySettingsController;
__decorate([
    (0, common_1.Get)('current'),
    (0, swagger_1.ApiOperation)({ summary: '取得目前顯示設定（MVP 基礎）' }),
    (0, swagger_1.ApiOkResponse)({ description: '顯示設定' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], DisplaySettingsController.prototype, "getCurrent", null);
__decorate([
    (0, common_1.Patch)('current'),
    (0, swagger_1.ApiOperation)({ summary: '更新目前顯示設定' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [update_display_setting_dto_1.UpdateDisplaySettingDto]),
    __metadata("design:returntype", void 0)
], DisplaySettingsController.prototype, "updateCurrent", null);
exports.DisplaySettingsController = DisplaySettingsController = __decorate([
    (0, swagger_1.ApiTags)('display-settings'),
    (0, common_1.Controller)('display-settings'),
    __metadata("design:paramtypes", [display_settings_service_1.DisplaySettingsService])
], DisplaySettingsController);
//# sourceMappingURL=display-settings.controller.js.map