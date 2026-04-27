"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MascotMode = exports.PopupCorner = exports.PopupTheme = exports.PopupSize = exports.RuleMode = exports.ScheduleType = void 0;
var ScheduleType;
(function (ScheduleType) {
    ScheduleType["ONE_TIME"] = "one_time";
    ScheduleType["RECURRING"] = "recurring";
})(ScheduleType || (exports.ScheduleType = ScheduleType = {}));
var RuleMode;
(function (RuleMode) {
    RuleMode["MONTHLY_DAY"] = "monthly_day";
    RuleMode["WEEKLY_DAY"] = "weekly_day";
    RuleMode["DAILY_TIME"] = "daily_time";
})(RuleMode || (exports.RuleMode = RuleMode = {}));
var PopupSize;
(function (PopupSize) {
    PopupSize["SMALL"] = "small";
    PopupSize["MEDIUM"] = "medium";
    PopupSize["LARGE"] = "large";
})(PopupSize || (exports.PopupSize = PopupSize = {}));
var PopupTheme;
(function (PopupTheme) {
    PopupTheme["LIGHT"] = "light";
    PopupTheme["DARK"] = "dark";
})(PopupTheme || (exports.PopupTheme = PopupTheme = {}));
var PopupCorner;
(function (PopupCorner) {
    PopupCorner["TOP_LEFT"] = "top_left";
    PopupCorner["TOP_RIGHT"] = "top_right";
    PopupCorner["BOTTOM_LEFT"] = "bottom_left";
    PopupCorner["BOTTOM_RIGHT"] = "bottom_right";
})(PopupCorner || (exports.PopupCorner = PopupCorner = {}));
var MascotMode;
(function (MascotMode) {
    MascotMode["SYSTEM"] = "system";
    MascotMode["CUSTOM"] = "custom";
})(MascotMode || (exports.MascotMode = MascotMode = {}));
//# sourceMappingURL=enums.js.map