# First Contact Demo

An epic multi-agent demonstration showcasing the USS Sentinel Horizon crew encountering an alien vessel. This demo highlights authentic LLM agent coordination, task management, and real-time communication capabilities of the MXF framework.

## Overview

The demo simulates a first contact scenario where a starship crew must coordinate to establish communication with an alien commander. It demonstrates:

- **Multi-Agent Coordination**: 5 human crew members + 1 alien commander working together
- **Real LLM Responses**: Using Claude 3.7 Sonnet, GPT-4.1-mini, Gemini Flash, and Grok models
- **Task Management**: SystemLLM-powered task assignment and monitoring
- **Communication Protocols**: Real-time messaging between agents
- **Translation Challenge**: Xenolinguistics expert translating alien symbols

## Running the Demo

1. Ensure MXF server is running:
   ```bash
   bun run server
   ```

2. Set up environment variables (OpenRouter API key required):
   ```bash
   export OPENROUTER_API_KEY=your_key_here
   ```

3. Run the demo:
   ```bash
   bun run examples/first-contact-demo/first-contact-demo.ts
   ```

## Cast of Characters

### USS Sentinel Horizon Crew:
- **Commander Kane** (Claude Sonnet 4): Mission leader and diplomatic decision maker
- **Dr. Chen** (GPT-4.1): Chief Science Officer analyzing alien technology
- **Lt. Rodriguez** (Gemini Flash): Tactical Officer assessing threats
- **Ensign Park** (Gemini Flash): Communications Officer establishing protocols
- **Dr. Xenara** (Claude Sonnet 4): Xenolinguistics expert translating alien messages

### Alien Vessel:
- **Commander Zenth** (Grok 3): Alien commander evaluating humanity

## Demo Flow

1. **Initialization**: Creates secure channel and authentication keys
2. **Crew Assembly**: Brings all 5 crew members online
3. **First Contact**: Commander Kane initiates contact protocols
4. **Alien Response**: Commander Zenth responds when crew communications detected
5. **Translation**: Dr. Xenara translates alien symbols and language
6. **Assessment**: Crew analyzes alien intentions
7. **Resolution**: Commander Kane makes final diplomatic decision

## Key Features Demonstrated

- Autonomous agent decision making
- Real-time message passing between agents
- Task creation and assignment
- Multi-model LLM coordination
- Event-driven architecture
- Cinematic logging with StoryLogger

## Architecture Notes

The demo uses:
- Event-based task assignment via EventBus
- Manual task assignment strategy for crew coordination
- Separate alien agent initialization triggered by crew activity
- Custom StoryLogger for immersive output formatting

## Customization

You can modify:
- Agent personalities and capabilities in crew configurations
- LLM models used by each agent
- Mission objectives and success criteria
- Communication patterns and protocols