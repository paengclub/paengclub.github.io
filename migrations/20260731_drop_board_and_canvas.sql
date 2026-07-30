-- 게시판 (board_posts/board_comments) and 그림판 (canvas_pixels) removed:
-- feature deleted from the frontend, and the data goes with it per request.
drop table if exists public.board_comments;
drop table if exists public.board_posts;
drop table if exists public.canvas_pixels;
