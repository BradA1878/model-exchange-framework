# Extensibility

MXF is designed for rapid extension and customization. You can extend the framework in several ways:

1. **Express API**
   - Add new routes in `src/server/api/routes`
   - Implement controllers in `src/server/api/controllers`
   - Use shared validation and schemas (`src/shared/utils/validation.ts`, `src/shared/schemas/**/*.ts`)

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

> **Tip:** Follow DRY principles and use shared utilities in `src/shared` for consistent behavior and validation.
