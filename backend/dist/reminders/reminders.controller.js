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
exports.RemindersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const create_reminder_dto_1 = require("./dto/create-reminder.dto");
const reorder_reminders_dto_1 = require("./dto/reorder-reminders.dto");
const update_reminder_dto_1 = require("./dto/update-reminder.dto");
const reminders_service_1 = require("./reminders.service");
let RemindersController = class RemindersController {
    remindersService;
    constructor(remindersService) {
        this.remindersService = remindersService;
    }
    findAll() {
        return this.remindersService.findAll();
    }
    findOne(id) {
        return this.remindersService.findOne(id);
    }
    create(dto) {
        return this.remindersService.create(dto);
    }
    update(id, dto) {
        return this.remindersService.update(id, dto);
    }
    remove(id) {
        return this.remindersService.remove(id);
    }
    enable(id) {
        return this.remindersService.setEnabled(id, true);
    }
    disable(id) {
        return this.remindersService.setEnabled(id, false);
    }
    reorder(dto) {
        return this.remindersService.reorder(dto);
    }
};
exports.RemindersController = RemindersController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: '取得提醒清單（MVP 基礎）' }),
    (0, swagger_1.ApiOkResponse)({ description: '提醒清單' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: '取得單一提醒' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: '建立提醒' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_reminder_dto_1.CreateReminderDto]),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: '更新提醒' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_reminder_dto_1.UpdateReminderDto]),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: '刪除提醒' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "remove", null);
__decorate([
    (0, common_1.Patch)(':id/enable'),
    (0, swagger_1.ApiOperation)({ summary: '啟用提醒' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "enable", null);
__decorate([
    (0, common_1.Patch)(':id/disable'),
    (0, swagger_1.ApiOperation)({ summary: '停用提醒' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "disable", null);
__decorate([
    (0, common_1.Post)('reorder'),
    (0, swagger_1.ApiOperation)({ summary: '批次調整提醒排序' }),
    (0, swagger_1.ApiBody)({ type: reorder_reminders_dto_1.ReorderRemindersDto }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [reorder_reminders_dto_1.ReorderRemindersDto]),
    __metadata("design:returntype", void 0)
], RemindersController.prototype, "reorder", null);
exports.RemindersController = RemindersController = __decorate([
    (0, swagger_1.ApiTags)('reminders'),
    (0, common_1.Controller)('reminders'),
    __metadata("design:paramtypes", [reminders_service_1.RemindersService])
], RemindersController);
//# sourceMappingURL=reminders.controller.js.map