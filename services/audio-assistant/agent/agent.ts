import { defineAgent } from 'eve';
export default defineAgent({model:'openai/gpt-6-luna-fast',reasoning:'high',defaultTools:false,limits:{maxInputTokensPerSession:12000,maxOutputTokensPerSession:4000}});
