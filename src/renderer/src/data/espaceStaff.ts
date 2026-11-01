// Who books which ministry's events in eSpace (from Jeremy's list, Oct 31 2026). Starting point only:
// after the first sync this list lives on the server and team admins manage it on the Event Calendar → eSpace.
// Terri and Laura book for 678, HSM and WAVE, so their events default to Students. Chris books for Small Groups and Kids.

/** eSpace's own ministry list. Separate from the Media Request ministries on purpose. */
export const ESPACE_MINISTRIES = ['Next Steps', 'Small Groups', 'Young Pros', '678', 'HSM', 'WAVE', 'Students', 'Kids', 'Imagine', 'Community', 'Missions', 'Creative/Worship']

export const ESPACE_STAFF: { name: string; email: string; ministry: string }[] = [
  { name: 'Essy Collins', email: 'essy.collins@northstarchurch.org', ministry: 'Next Steps' },
  { name: 'C.A. Phillips', email: 'ca.phillips@northstarchurch.org', ministry: 'Small Groups' },
  { name: 'Bridget Turner', email: 'bridget.turner@northstarchurch.org', ministry: 'Small Groups' },
  { name: 'Greg Payne', email: 'greg.payne@northstarchurch.org', ministry: 'Small Groups' },
  { name: 'Drew Startup', email: 'drew.startup@northstarchurch.org', ministry: 'Small Groups' },
  { name: 'Chris Boggess', email: 'chris.boggess@northstarchurch.org', ministry: 'Small Groups' },
  { name: 'Kayla Stahl', email: 'kayla.stahl@northstarchurch.org', ministry: 'Young Pros' },
  { name: 'Riley Britton', email: 'riley.britton@northstarchurch.org', ministry: '678' },
  { name: 'Laura Wormald', email: 'laura.wormald@northstarchurch.org', ministry: 'Students' },
  { name: 'Terri Reichert', email: 'terri.reichert@northstarchurch.org', ministry: 'Students' },
  { name: 'Wilson Joiner', email: 'wilson.joiner@northstarchurch.org', ministry: 'HSM' },
  { name: 'Sellers Hickman', email: 'sellers.hickman@northstarchurch.org', ministry: 'WAVE' },
  { name: 'Hank Sledge', email: 'hank.sledge@northstarchurch.org', ministry: 'WAVE' },
  { name: 'Erin Weir', email: 'erin.weir@northstarchurch.org', ministry: 'WAVE' },
  { name: 'Mallory Jones', email: 'mallory.jones@northstarchurch.org', ministry: 'WAVE' },
  { name: 'Keilly Michael', email: 'keilly.michael@northstarchurch.org', ministry: 'Kids' },
  { name: 'Haley Moyer', email: 'haley.moyer@northstarchurch.org', ministry: 'Kids' },
  { name: 'Heather Adams', email: 'heather.adams@northstarchurch.org', ministry: 'Kids' },
  { name: 'Rebecca Morgan', email: 'rebecca.morgan@northstarchurch.org', ministry: 'Imagine' },
  { name: 'Zach Fisher', email: 'zach.fisher@northstarchurch.org', ministry: 'Community' },
  { name: 'Jessica Fisher', email: 'jessica.fisher@northstarchurch.org', ministry: 'Community' },
  { name: 'Jeannine Rhein', email: 'jeannine.rhein@northstarchurch.org', ministry: 'Community' },
  { name: 'Megan Strange', email: 'megan.strange@northstarchurch.org', ministry: 'Missions' },
  { name: 'Kimberly McDurmon', email: 'kimberly.mcdurmon@northstarchurch.org', ministry: 'Missions' },
  { name: 'Seth Hardy', email: 'seth.hardy@northstarchurch.org', ministry: 'Creative/Worship' }
]
