"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const folderController_1 = require("../controllers/folderController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.get('/', authMiddleware_1.authMiddleware, folderController_1.getFolders);
router.get('/tree', authMiddleware_1.authMiddleware, folderController_1.getFolderTree);
router.get('/:id', authMiddleware_1.authMiddleware, folderController_1.getFolder);
router.post('/', authMiddleware_1.authMiddleware, folderController_1.createFolder);
router.put('/:id', authMiddleware_1.authMiddleware, folderController_1.updateFolder);
router.delete('/:id', authMiddleware_1.authMiddleware, folderController_1.deleteFolder);
exports.default = router;
//# sourceMappingURL=folderRoutes.js.map