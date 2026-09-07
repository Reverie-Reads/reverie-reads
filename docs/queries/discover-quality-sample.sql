begin read only;
with ranked as (
 select id, title, contributors, isbns, genre, tags, cover_url, description, pub_y,
 row_number() over (partition by genre order by title,id) as rn,
 count(*) over (partition by genre) as genre_count
 from public.works
 where genre in ('romance','fantasy','science fiction','horror','mystery','literary','cozy','nonfiction','young adult')
)
select id, title, contributors, isbns, genre, tags, cover_url, description, pub_y, genre_count
from ranked where rn <= 8 order by genre,title,id;
commit;
