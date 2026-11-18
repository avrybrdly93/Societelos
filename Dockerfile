FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
# Locked production defaults (TASK-795); override with docker run -e.
ENV DEBATE_SECONDS=60 SHOW_FORECAST_BEFORE_VOTE=false
EXPOSE 3000
CMD ["npm", "start"]
