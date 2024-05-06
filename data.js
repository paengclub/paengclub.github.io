let itineraries = [
    {name:'예지민', date:'2024-04-15', type:'한국 귀국'},
    {name:'김현서', date:'2024-09-12', type:'훈련소 수료'},
    {name:'팽지원', date:'2024-08-19', type:'말출'},
    {name:'이승우', date:'2024-12-17', type:'말출'},
    {name:'심우재', date:'2024-10-02', type:'하사 진급'}
];

// dates: [입대, 일병, 상병, 병장, 전역, 말출]
let members = [
    {name:'예지민', rank:'SGT.svg', dates:['2023-01-30', '2023-04-01', '2023-10-01', '2024-04-01', '2024-07-29', '2024-07-29'], ANF:'육군', isDischarged:'false'},
    {name:'팽지원', rank:'CPL.svg', dates:['2023-03-20', '2023-06-01', '2023-12-01', '2024-06-01', '2024-09-19', '2024-08-19'], ANF:'육군', isDischarged:'false'},
    {name:'심우재', rank:'CPL.svg', dates:['2023-04-03', '2023-07-01', '2024-01-01', '2024-07-01', '2025-04-02', '2025-04-02'], ANF:'육군', isDischarged:'false'},
    {name:'최재우', rank:'CPL.svg', dates:['2023-04-10', '2023-07-01', '2024-01-01', '2024-07-01', '2024-10-09', '2024-10-09'], ANF:'육군', isDischarged:'false'},
    {name:'이승우', rank:'CPL.svg', dates:['2023-04-24', '2023-06-24', '2023-12-24', '2024-06-24', '2025-01-23', '2024-12-17'], ANF:'공군', isDischarged:'false'},
    {name:'이성민', rank:'CPL.svg', dates:['2023-07-10', '2023-09-10', '2024-03-10', '2024-09-10', '2025-04-09', '2025-04-09'], ANF:'공군', isDischarged:'false'},
    {name:'문성훈', rank:'CPL.svg', dates:['2023-07-31', '2023-10-01', '2024-04-01', '2024-10-01', '2025-01-30', '2025-01-30'], ANF:'육군', isDischarged:'false'},
    {name:'오강현', rank:'GEN.svg', dates:['2024-02-01', '2024-04-01', '2024-10-01', '2025-04-01', '2025-10-31', '2025-10-31'], ANF:'공익', isDischarged:'false'},
    {name:'김병용', rank:'GEN.svg', dates:['2024-05-27', '2024-08-01', '2025-02-01', '2025-08-01', '2025-11-26', '2025-11-26'], ANF:'육군', isDischarged:'false'},
    {name:'김형빈', rank:'GEN.svg', dates:['2024-09-30', '2024-12-01', '2025-06-01', '2025-12-01', '2026-03-29', '2026-03-29'], ANF:'해병', isDischarged:'false'},
    {name:'김현서', rank:'GEN.svg', dates:['2024-08-22', '2024-11-01', '2025-05-01', '2025-11-01', '2026-05-22', '2026-05-22'], ANF:'공익', isDischarged:'false'},
    {name:'허채민', rank:'PFC.svg', dates:['2022-10-04', '2023-01-01', '2023-08-01', '2024-02-01', '2024-04-03', '2024-04-03'], ANF:'육군', isDischarged:'true'}
];

export {itineraries, members};
