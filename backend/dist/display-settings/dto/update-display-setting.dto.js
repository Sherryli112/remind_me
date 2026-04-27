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
exports.UpdateDisplaySettingDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const enums_1 = require("../../common/enums");
class UpdateDisplaySettingDto {
    size;
    theme;
    corner;
    showContent;
    targetScreenId;
    mascotMode;
}
exports.UpdateDisplaySettingDto = UpdateDisplaySettingDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: enums_1.PopupSize }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(enums_1.PopupSize),
    __metadata("design:type", String)
], UpdateDisplaySettingDto.prototype, "size", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: enums_1.PopupTheme }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(enums_1.PopupTheme),
    __metadata("design:type", String)
], UpdateDisplaySettingDto.prototype, "theme", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: enums_1.PopupCorner }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(enums_1.PopupCorner),
    __metadata("design:type", String)
], UpdateDisplaySettingDto.prototype, "corner", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateDisplaySettingDto.prototype, "showContent", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateDisplaySettingDto.prototype, "targetScreenId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: enums_1.MascotMode }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(enums_1.MascotMode),
    __metadata("design:type", String)
], UpdateDisplaySettingDto.prototype, "mascotMode", void 0);
//# sourceMappingURL=update-display-setting.dto.js.map