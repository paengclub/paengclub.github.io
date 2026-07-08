let itineraries = [
    {name:'예지민', date:'2024-04-15', type:'한국 귀국'},
    {name:'김현서', date:'2024-09-12', type:'훈련소 수료'},
    {name:'이승우', date:'2024-08-12', type:'휴가 출발'},
    {name:'이승우', date:'2024-08-16', type:'휴가 복귀'},
    {name:'팽지원', date:'2024-08-19', type:'말출'},
    {name:'이승우', date:'2024-09-22', type:'휴가 출발'},
    {name:'이승우', date:'2024-09-26', type:'휴가 복귀'},
    {name:'이승우', date:'2024-10-27', type:'휴가 출발'},
    {name:'이승우', date:'2024-10-31', type:'휴가 복귀'},
    {name:'허채민', date:'2024-11-14', type:'수능'},
    {name:'이승우', date:'2024-12-02', type:'휴가 출발'},
    {name:'이승우', date:'2024-12-05', type:'휴가 복귀'},
    {name:'이승우', date:'2024-12-17', type:'말출'},
    {name:'심우재', date:'2024-10-02', type:'하사 진급'}
];

// dates: [입대, 일병, 상병, 병장, 전역, 말출]
let members = [
    {name:'예지민', rank:'SGT.svg', dates:['2023-01-30', '2023-04-01', '2023-10-01', '2024-04-01', '2024-07-29', '2024-07-06'], ANF:'육군', isDischarged:'true'},
    {name:'팽지원', rank:'CPL.svg', dates:['2023-03-20', '2023-06-01', '2023-12-01', '2024-06-01', '2024-09-19', '2024-09-19'], ANF:'육군', isDischarged:'true'},
    {name:'심우재', rank:'CPL.svg', dates:['2023-04-03', '2023-07-01', '2024-01-01', '2024-07-01', '2025-04-02', '2025-04-02'], ANF:'육군', isDischarged:'true'},
    {name:'최재우', rank:'CPL.svg', dates:['2023-04-10', '2023-07-01', '2024-01-01', '2024-07-01', '2024-10-09', '2024-10-09'], ANF:'육군', isDischarged:'true'},
    {name:'이승우', rank:'CPL.svg', dates:['2023-04-24', '2023-06-24', '2023-12-24', '2024-07-01', '2025-01-23', '2024-12-17'], ANF:'공군', isDischarged:'true'},
    {name:'이성민', rank:'CPL.svg', dates:['2023-07-10', '2023-09-10', '2024-03-10', '2024-10-01', '2025-04-09', '2025-04-09'], ANF:'공군', isDischarged:'true'},
    {name:'문성훈', rank:'CPL.svg', dates:['2023-07-31', '2023-10-01', '2024-04-01', '2024-10-01', '2025-01-30', '2025-01-30'], ANF:'육군', isDischarged:'true'},
    {name:'오강현', rank:'GEN.svg', dates:['2024-02-01', '2024-04-01', '2024-10-01', '2025-04-01', '2025-10-31', '2025-10-31'], ANF:'공익', isDischarged:'true'},
    {name:'김병용', rank:'GEN.svg', dates:['2024-05-27', '2024-08-01', '2025-02-01', '2025-08-01', '2025-11-26', '2025-11-26'], ANF:'육군', isDischarged:'true'},
    {name:'김형빈', rank:'GEN.svg', dates:['2024-08-05', '2024-10-05', '2025-04-05', '2025-10-05', '2026-05-04', '2026-05-04'], ANF:'공군', isDischarged:'true'},
    {name:'김현서', rank:'GEN.svg', dates:['2024-08-22', '2024-11-01', '2025-05-01', '2025-11-01', '2026-05-22', '2026-05-22'], ANF:'공익', isDischarged:'true'},
    {name:'허채민', rank:'PFC.svg', dates:['2022-10-04', '2023-01-01', '2023-08-01', '2024-02-01', '2024-04-03', '2024-04-03'], ANF:'육군', isDischarged:'true'}
];

const weightData = [
    {
        id: "paeng",
        name: "paeng",
        goal: "loss",
        color: "#2f7dd3",
        records: [
            { date: "2024-08-07", weight: 67.4 },
            { date: "2024-11-15", weight: 68.5 },
            { date: "2025-06-13", weight: 65.2 },
            { date: "2026-01-12", weight: 73.4 },
            { date: "2026-04-26", weight: 70.6 },
            { date: "2026-05-12", weight: 70.1 },
            { date: "2026-05-16", weight: 70.3 },
            { date: "2026-05-28", weight: 69.6 },
            { date: "2026-05-29", weight: 69.7 },
            { date: "2026-06-01", weight: 70.3 },
            { date: "2026-06-05", weight: 69.5 },
            { date: "2026-06-10", weight: 70.1 },
        ],
    },
    {
        id: "okh",
        name: "okh",
        goal: "gain",
        color: "#d16a45",
        records: [
            { date: "2024-08-07", weight: 59.0 },
            { date: "2024-11-15", weight: 61.0 },
            { date: "2025-06-13", weight: 61.5 },
            { date: "2026-01-12", weight: 66.0 },
            { date: "2026-04-26", weight: 66.5 },
            { date: "2026-05-12", weight: 67.6 },
            { date: "2026-05-16", weight: 66.8 },
            { date: "2026-05-28", weight: 66.2 },
            { date: "2026-05-29", weight: 67.2 },
            { date: "2026-06-01", weight: 66.4 },
            { date: "2026-06-05", weight: 66.7 },
            { date: "2026-06-10", weight: 66.5 },
        ],
    },
];

export {itineraries, members, weightData};
