-- Support a course meeting on multiple days (월수, 화목 등): day_of_week (single)
-- becomes days (smallint[]). Existing rows are preserved as a 1-element array.
alter table public.timetable_courses add column days smallint[];
update public.timetable_courses set days = array[day_of_week]::smallint[];
alter table public.timetable_courses alter column days set not null;
alter table public.timetable_courses add constraint timetable_courses_days_valid check (
    array_length(days, 1) between 1 and 7 and days <@ array[0,1,2,3,4,5,6]::smallint[]
);
alter table public.timetable_courses drop column day_of_week;

-- 5-minute granularity is plenty for a class schedule.
alter table public.timetable_courses add constraint timetable_courses_start_step check (start_minute % 5 = 0);
alter table public.timetable_courses add constraint timetable_courses_end_step check (end_minute % 5 = 0);
