FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app/data /app/uploads

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

USER node
EXPOSE 3000
CMD ["npm", "start"]
