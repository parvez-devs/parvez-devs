# Live Preview Admin

Railway deployment source for the streaming-style landing page.

- Public page: /
- Admin: /admin
- Persistent data: DATA_DIR (Railway volume mounted at /data)
- Global fullscreen redirect is editable in admin.
- GIF/WebP/JPG/PNG uploads persist on the volume.

Required environment variables:
- PORT=3000
- DATA_DIR=/data
- NODE_ENV=production
- ADMIN_USER
- ADMIN_PASSWORD
- SESSION_SECRET
