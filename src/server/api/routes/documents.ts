/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

import express from 'express';
import * as documentController from '../controllers/documentController';

const router = express.Router();

/**
 * Document Management Routes
 * All routes require authentication (middleware applied at server level)
 */

// Document CRUD operations
router.get('/', documentController.getDocuments);                          // GET /api/documents
router.post('/', documentController.createDocument);                       // POST /api/documents
router.get('/stats', documentController.getDocumentStats);                 // GET /api/documents/stats
router.get('/:documentId', documentController.getDocumentById);            // GET /api/documents/:documentId
router.put('/:documentId', documentController.updateDocument);             // PUT /api/documents/:documentId
router.delete('/:documentId', documentController.deleteDocument);          // DELETE /api/documents/:documentId
router.get('/:documentId/download', documentController.downloadDocument);  // GET /api/documents/:documentId/download

export default router;
