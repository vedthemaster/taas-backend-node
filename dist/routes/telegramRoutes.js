"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const telegramController_1 = require("../controllers/telegramController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.post('/setup', authMiddleware_1.authMiddleware, telegramController_1.setupTelegram);
router.get('/status', authMiddleware_1.authMiddleware, telegramController_1.getTelegramStatus);
router.post('/validate', authMiddleware_1.authMiddleware, telegramController_1.validateTelegram);
exports.default = router;
//# sourceMappingURL=telegramRoutes.js.map