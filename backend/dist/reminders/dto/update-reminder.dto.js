"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateReminderDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const create_reminder_dto_1 = require("./create-reminder.dto");
class UpdateReminderDto extends (0, swagger_1.PartialType)(create_reminder_dto_1.CreateReminderDto) {
}
exports.UpdateReminderDto = UpdateReminderDto;
//# sourceMappingURL=update-reminder.dto.js.map