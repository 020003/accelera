# Stage 1: Build the frontend
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ARG VITE_BACKEND_HOSTS
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
ENV BACKEND_URL=backend:5001
ENV NGINX_ENVSUBST_FILTER=BACKEND_URL
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
