# No package installation: the server uses only Node's standard library.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --chown=node:node server.js ai-service.js core.js app.js index.html style.css package.json ./
USER node
EXPOSE 8080
CMD ["node", "server.js"]
