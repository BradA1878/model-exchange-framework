# Extensibility

MXF is designed for rapid extension and customization. You can extend the framework in several ways:

1. **Express API**
   - Add new routes in `src/server/api/routes`
   - Implement controllers in `src/server/api/controllers`
   - Use shared validation and schemas (`packages/core/src/utils/validation.ts`, `packages/core/src/schemas/**/*.ts`)

2. **Dashboard**
   - Add new views/components in `dashboard/src/views`
   - Create Pinia stores in `dashboard/src/stores`
   - Update navigation in `dashboard/src/router/index.ts`

3. **SDK**
   - Extend `MXFClient` with custom methods or endpoints
   - Add new TypeScript interfaces in `sdk/src`

4. **LLM Providers**
   - Register new provider configurations in `src/server/api/controllers/configController.ts`
   - Implement network adapters or custom models

5. **Custom Agents/Tasks**
   - Define new agent types or capabilities via configuration
   - Extend task assignment logic in `src/server/services/taskService.ts`

> **Tip:** Follow DRY principles and use shared utilities in `packages/core/src` for consistent behavior and validation.
